import { marked } from 'marked';
import { icons } from './icons.js';
import './styles.css';

const STORAGE_PREFIX = 'vanessa-conversations';
const API_BASE = `${import.meta.env.BASE_URL}api`;
const THEME_KEY = 'vanessa-theme';
const PROFILE_KEY = 'vanessa-profile';
const MODEL_KEY = 'vanessa-model';
const MIGRATION_KEY = 'vanessa-history-migrated';
const PROFILES = ['Vincent', 'Dolly'];

let currentProfile = localStorage.getItem(PROFILE_KEY);
let conversations = [];
let activeId = null;
let isLoading = false;
let currentModel = '';
let currentVersion = '';
let maxFileSizeMb = 10;
let pendingAttachments = [];
const messageAttachments = new Map();
let profileLoadGeneration = 0;
let activeStream = null;

function conversationIdFromUrl() {
  return new URL(window.location.href).searchParams.get('conversation');
}

function setConversationUrl(id, { replace = false } = {}) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('conversation', id);
  else url.searchParams.delete('conversation');
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

marked.use({ breaks: true, gfm: true });

document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) || 'light';
document.querySelector('#app').innerHTML = `
  <div class="profile-gate ${currentProfile ? 'hidden' : ''}" id="profile-gate">
    <div class="profile-card">
      <div class="profile-mark">${icons.secretary}</div>
      <h1>Vanessa The Secretary</h1>
      <p>Ai đang sử dụng Vanessa?</p>
      <div class="profile-options">${PROFILES.map(name => `<button class="profile-option" data-profile="${name}"><span class="avatar">${name[0]}</span>${name}</button>`).join('')}</div>
    </div>
  </div>
  <aside class="sidebar" id="sidebar">
    <div class="brand">${icons.secretary}<span>Vanessa The Secretary</span></div>
    <button class="new-chat" id="new-chat">${icons.plus} Cuộc trò chuyện mới</button>
    <ul class="history-list" id="history-list"></ul>
    <div class="sidebar-footer"><button class="profile-button" id="profile-button" title="Đổi người dùng"><span class="avatar" id="profile-avatar"></span><span id="profile-name"></span></button><button class="theme-toggle" id="theme-toggle" aria-label="Đổi giao diện"></button></div>
  </aside>
  <main class="chat-area">
    <header class="chat-header"><div><div class="chat-title" id="chat-title">Cuộc trò chuyện mới</div><small class="app-version" id="app-version">Đang kết nối...</small></div><div class="header-actions"><label class="model-picker"><span>Model</span><select id="model-select" aria-label="Chọn model" disabled><option>Đang tải...</option></select></label><button class="mobile-menu" id="mobile-menu" aria-label="Mở menu">${icons.menu}</button></div></header>
    <section class="messages" id="messages"></section>
    <button class="scroll-bottom hidden" id="scroll-bottom" type="button" aria-label="Cuộn xuống cuối">${icons.arrowDown}</button>
    <form class="composer" id="composer">
      <div class="attachment-list hidden" id="attachment-list"></div>
      <div class="composer-inner"><input id="file-input" type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.html,.htm,.css,.js,.mjs,.cjs,.ts,.tsx,.jsx,.vue,.svelte,.py,.java,.kt,.kts,.c,.h,.cpp,.hpp,.cs,.go,.rs,.rb,.php,.swift,.sql,.sh,.bash,.ps1,.bat,.cmd,.ini,.toml,.env,.log,.conf,.properties,.gradle,.dockerfile,.gitignore,.graphql,.gql,.r,.lua,.tex,.pdf,.docx,.xlsx,.pptx"><button class="attach-btn" id="attach" type="button" aria-label="Đính kèm file hoặc ảnh" title="Đính kèm file hoặc ảnh">${icons.paperclip}</button><textarea id="prompt" rows="1" placeholder="Hỏi bất kỳ điều gì..." aria-label="Nội dung câu hỏi"></textarea><button class="send-btn" id="send" type="submit" disabled>${icons.send}</button></div>
    </form>
  </main>`;

const elements = Object.fromEntries(['sidebar', 'history-list', 'chat-title', 'messages', 'scroll-bottom', 'composer', 'prompt', 'send', 'attach', 'file-input', 'attachment-list', 'new-chat', 'theme-toggle', 'mobile-menu', 'profile-gate', 'profile-button', 'profile-avatar', 'profile-name', 'app-version', 'model-select'].map(id => [id, document.getElementById(id)]));

function storageKey(profile = currentProfile) {
  return `${STORAGE_PREFIX}:${profile?.toLowerCase()}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

function parseStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

async function loadProfileData(profile = currentProfile) {
  if (!profile) return { conversations: [], activeId: null };
  const generation = ++profileLoadGeneration;
  const localValue = parseStoredJson(storageKey(profile), []);
  const local = Array.isArray(localValue) ? localValue : [];
  const migratedValue = parseStoredJson(MIGRATION_KEY, {});
  const migrated = Array.isArray(migratedValue) ? {} : migratedValue;
  if (local.length && !migrated[profile]) {
    await api('/history/import', { method: 'POST', body: JSON.stringify({ profile, conversations: local }) });
    if (generation !== profileLoadGeneration) return null;
    migrated[profile] = true;
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(migrated));
  }
  const summaries = await api(`/conversations?profile=${encodeURIComponent(profile)}`);
  const loadedResults = await Promise.allSettled(summaries.map(async conversation => ({
    ...conversation,
    messages: await api(`/conversations/${encodeURIComponent(conversation.id)}/messages?profile=${encodeURIComponent(profile)}`),
  })));
  const loaded = loadedResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (generation !== profileLoadGeneration) return null;
  const requestedId = conversationIdFromUrl();
  return { conversations: loaded, activeId: loaded.some(item => item.id === requestedId) ? requestedId : null };
}

function activeConversation() {
  return conversations.find(item => item.id === activeId);
}

function startNewConversation() {
  activeId = null;
  pendingAttachments = [];
  renderAttachments();
  setConversationUrl(null);
  render({ scrollToEnd: true });
  elements.prompt.focus();
}

function save() {
  // History is persisted through the API; localStorage is only retained for one-time migration.
}

function formatTime(value) {
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function renderMarkdown(content) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = marked.parse(content || '');
  wrapper.querySelectorAll('script, style, iframe, object, embed, form').forEach(element => element.remove());
  wrapper.querySelectorAll('*').forEach(element => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith('on') || attribute.name === 'srcdoc') element.removeAttribute(attribute.name);
      if (['href', 'src'].includes(attribute.name)) {
        try {
          const url = new URL(attribute.value, window.location.origin);
          const allowed = attribute.name === 'href' ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
          if (!allowed.includes(url.protocol)) element.removeAttribute(attribute.name);
        } catch {
          element.removeAttribute(attribute.name);
        }
      }
    }
  });
  wrapper.querySelectorAll('a').forEach(link => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  return wrapper.innerHTML;
}

function stripThinking(content) {
  return content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<\/think\s*>/gi, '')
    .trimStart();
}

function render({ scrollToEnd = false, revealAtEnd = false } = {}) {
  const conversation = activeConversation();
  if (revealAtEnd) elements.messages.style.visibility = 'hidden';
  elements['history-list'].innerHTML = conversations.map(item => `<li class="history-item ${item.id === activeId ? 'active' : ''}" data-id="${item.id}"><span class="history-title">${escapeHtml(item.title)}</span><button class="delete-chat" data-delete="${item.id}" aria-label="Xóa cuộc trò chuyện">${icons.trash}</button></li>`).join('');
  elements['chat-title'].textContent = conversation?.title || 'Cuộc trò chuyện mới';
  elements['profile-name'].textContent = currentProfile || '';
  elements['profile-avatar'].textContent = currentProfile?.[0] || '';

  if (!conversation?.messages.length) {
    elements.messages.replaceChildren(renderEmptyState());
    elements.messages.style.visibility = '';
    updateThemeIcon();
    return;
  }

  elements.messages.querySelectorAll(':scope > :not([data-message-id])').forEach(node => node.remove());

  const existingNodes = new Map([...elements.messages.children].filter(node => node.dataset?.messageId).map(node => [node.dataset.messageId, node]));
  const seenIds = new Set();

  for (const message of conversation.messages) {
    seenIds.add(message.id);
    let node = existingNodes.get(message.id);
    if (!node) {
      node = createMessageNode(message);
      elements.messages.append(node);
    } else {
      syncMessageNode(node, message);
    }
  }

  for (const [id, node] of existingNodes) {
    if (!seenIds.has(id)) node.remove();
  }

  if (scrollToEnd || isNearBottom(elements.messages)) {
    scrollToBottom(elements.messages, false);
  }
  if (revealAtEnd) {
    requestAnimationFrame(() => {
      scrollToBottom(elements.messages, false);
      elements.messages.style.visibility = '';
    });
  }
  updateThemeIcon();
}

function renderEmptyState() {
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state';
  wrapper.innerHTML = '<h2>Xin chào, tôi là Vanessa.</h2><p>Tôi hỗ trợ hỏi đáp, phân tích thông tin, soạn thảo và tổng hợp nội dung theo yêu cầu của bạn.</p>';
  return wrapper;
}

function createMessageNode(message) {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  article.dataset.messageId = message.id;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const meta = document.createElement('div');
  meta.className = 'meta';
  const metaLabel = document.createElement('span');
  metaLabel.textContent = `${message.role === 'user' ? 'Bạn' : 'Vanessa'} · ${formatTime(message.createdAt)}`;
  meta.append(metaLabel);
  article.append(bubble, meta);
  syncMessageNode(article, message);
  return article;
}

function syncMessageNode(node, message) {
  const bubble = node.querySelector('.bubble');
  const meta = node.querySelector('.meta');
  if (message.pending) {
    if (!bubble.querySelector('.thinking-state')) {
      bubble.innerHTML = `<div class="thinking-state" role="status"><span class="thinking-pulse"></span><span>Đang suy nghĩ<span data-thinking-time="${message.id}">${message.thinkingSeconds ? ` · ${message.thinkingSeconds}s` : ''}</span></span></div>`;
    }
  } else {
    const rendered = renderMarkdown(message.content);
    const cursorNeeded = message.streaming;
    if (bubble.dataset.renderedContent !== rendered) {
      bubble.innerHTML = rendered;
      bubble.dataset.renderedContent = rendered;
    }
    const currentCursor = bubble.querySelector('.stream-cursor');
    if (cursorNeeded && !currentCursor) {
      const cursor = document.createElement('span');
      cursor.className = 'stream-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      bubble.append(cursor);
    } else if (!cursorNeeded && currentCursor) {
      currentCursor.remove();
    }
  }
  if (message.role === 'assistant' && message.content) {
    if (!meta.querySelector('.copy-btn')) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.dataset.copy = message.id;
      copyBtn.innerHTML = `${icons.copy} Sao chép`;
      meta.append(copyBtn);
    }
  } else {
    meta.querySelector('.copy-btn')?.remove();
  }
  const failed = message.error || message.content?.startsWith('Không thể kết nối tới mô hình.');
  const retryable = failed && !message.attachmentNames?.length;
  if (retryable && !meta.querySelector('.retry-message-btn')) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-message-btn';
    retryBtn.dataset.retryMessage = message.id;
    retryBtn.innerHTML = `${icons.retry} Thử lại`;
    meta.append(retryBtn);
  } else if (!retryable) {
    meta.querySelector('.retry-message-btn')?.remove();
  }
  if (message.attachmentNames?.length && !bubble.querySelector('.message-files')) {
    const files = document.createElement('div');
    files.className = 'message-files';
    const attachments = messageAttachments.get(message.id) || [];
    const images = attachments.filter(attachment => attachment.imageUrl);
    if (images.length) {
      files.classList.add('has-images');
      for (const image of images) {
        const thumbnail = document.createElement('img');
        thumbnail.src = image.imageUrl;
        thumbnail.alt = image.name;
        thumbnail.title = image.name;
        files.append(thumbnail);
      }
    }
    const nonImageNames = message.attachmentNames.filter(name => !images.some(image => image.name === name));
    if (nonImageNames.length) {
      const names = document.createElement('span');
      names.textContent = nonImageNames.join(', ');
      files.append(names);
    }
    bubble.prepend(files);
  }
}

function renderStreamingMessage(message) {
  const shouldFollowStream = isNearBottom(elements.messages);
  let node = elements.messages.querySelector(`[data-message-id="${message.id}"]`);
  if (!node) {
    node = createMessageNode(message);
    elements.messages.append(node);
  } else {
    syncMessageNode(node, message);
  }
  if (shouldFollowStream) {
    scrollToBottom(elements.messages, false);
  }
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

async function createConversation() {
  pendingAttachments = [];
  renderAttachments();
  const conversation = { id: crypto.randomUUID(), title: 'Cuộc trò chuyện mới', messages: [], createdAt: Date.now() };
  await api('/conversations', { method: 'POST', body: JSON.stringify({ ...conversation, profile: currentProfile }) });
  conversations.unshift(conversation);
  activeId = conversation.id;
  setConversationUrl(conversation.id, { replace: true });
  render();
  elements.prompt.focus();
}

async function selectProfile(profile) {
  if (!PROFILES.includes(profile)) return;
  if (isLoading) return;
  const loaded = await loadProfileData(profile);
  if (!loaded) return;
  currentProfile = profile;
  conversations = loaded.conversations;
  activeId = loaded.activeId;
  if (!activeId) setConversationUrl(null, { replace: true });
  pendingAttachments = [];
  renderAttachments();
  localStorage.setItem(PROFILE_KEY, profile);
  elements['profile-gate'].classList.add('hidden');
  render();
  elements.prompt.focus();
}

async function deleteConversation(id) {
  const index = conversations.findIndex(item => item.id === id);
  if (index === -1) return;
  await api(`/conversations/${encodeURIComponent(id)}?profile=${encodeURIComponent(currentProfile)}`, { method: 'DELETE' });
  conversations.splice(index, 1);
  if (activeId === id) {
    activeId = null;
    setConversationUrl(null, { replace: true });
  }
  render();
}

function updateThemeIcon() {
  elements['theme-toggle'].innerHTML = document.documentElement.dataset.theme === 'dark' ? icons.sun : icons.moon;
}

async function streamResponse(messages, assistantMessage, attachments, streamContext) {
  const requestId = crypto.randomUUID();
  console.info(`[chat:${requestId}] POST ${API_BASE}/chat`, { model: currentModel, messageCount: messages.length, page: window.location.href });
  const controller = new AbortController();
  activeStream = { ...streamContext, controller };
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })), model: currentModel, attachments }),
    signal: controller.signal,
  });
  console.info(`[chat:${requestId}] response`, { status: response.status, statusText: response.statusText, url: response.url, contentType: response.headers.get('content-type') });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const body = JSON.parse(text);
      message = body.error?.message || body.error || body.message || text;
    } catch { /* Keep the original response body. */ }
    console.error(`[chat:${requestId}] request failed`, { status: response.status, url: response.url, body: text });
    throw new Error(`HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  const responseModel = response.headers.get('X-Vanessa-Model');
  if (responseModel) {
    elements['app-version'].textContent = `${responseModel} · ${currentVersion}`;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const processLine = line => {
    const data = line.trim().replace(/^data:\s*/, '');
    if (!data) return;
    if (data === '[DONE]') {
      completed = true;
      return;
    }
    try {
      const chunk = JSON.parse(data);
      assistantMessage.rawContent += chunk.choices?.[0]?.delta?.content || '';
      assistantMessage.content = stripThinking(assistantMessage.rawContent);
      assistantMessage.pending = !assistantMessage.content;
      assistantMessage.streaming = Boolean(assistantMessage.content);
      if (activeStream?.conversationId === streamContext.conversationId && activeId === streamContext.conversationId && currentProfile === streamContext.profile) renderStreamingMessage(assistantMessage);
    } catch { /* Ignore SSE comments and provider metadata. */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);
  if (!completed) throw new Error('Luồng phản hồi kết thúc trước khi hoàn tất.');
}

async function submitPrompt(event) {
  event.preventDefault();
  const content = elements.prompt.value.trim();
  if ((!content && !pendingAttachments.some(file => file.content || file.imageUrl)) || isLoading || pendingAttachments.some(file => file.loading)) return;
  if (!activeConversation()) await createConversation();
  const conversation = activeConversation();
  const attachments = pendingAttachments.filter(file => file.content || file.imageUrl).map(file => ({ name: file.name, content: file.content, imageUrl: file.imageUrl, type: file.type }));
  const attachmentNames = attachments.map(file => file.name);
  const displayContent = content || 'Hãy đọc và phân tích nội dung đính kèm.';
  const userMessage = { id: crypto.randomUUID(), role: 'user', content: displayContent, attachmentNames, createdAt: Date.now() };
  conversation.messages.push(userMessage);
  if (attachments.length) messageAttachments.set(userMessage.id, attachments);
  const title = content || attachmentNames.join(', ');
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', rawContent: '', pending: true, streaming: false, thinkingSeconds: 0, createdAt: Date.now() };
  conversation.messages.push(assistantMessage);
  const firstTurn = conversation.messages.filter(m => m.role === 'user').length === 1;
  const nextTitle = firstTurn ? title.slice(0, 42) + (title.length > 42 ? '…' : '') : null;
  try {
    await api(`/conversations/${encodeURIComponent(conversation.id)}/turns`, { method: 'POST', body: JSON.stringify({ profile: currentProfile, userMessage, assistantMessage: { ...assistantMessage, content: '' }, title: nextTitle }) });
  } catch (error) {
    conversation.messages.splice(-2, 2);
    messageAttachments.delete(userMessage.id);
    render();
    window.alert(`Không thể lưu tin nhắn: ${error.message}`);
    return;
  }
  if (nextTitle) conversation.title = nextTitle;
  elements.prompt.value = '';
  elements.prompt.style.height = 'auto';
  pendingAttachments = [];
  renderAttachments();
  isLoading = true;
  elements['model-select'].disabled = true;
  elements.send.disabled = true;
  save();
  render({ scrollToEnd: true });

  const thinkingTimer = window.setInterval(() => {
    if (!assistantMessage.pending) return;
    assistantMessage.thinkingSeconds += 1;
    const timer = elements.messages.querySelector(`[data-thinking-time="${assistantMessage.id}"]`);
    if (timer) timer.textContent = ` · ${assistantMessage.thinkingSeconds}s`;
  }, 1000);

  try {
    await streamResponse(conversation.messages.slice(0, -1), assistantMessage, attachments, { profile: currentProfile, conversationId: conversation.id });
  } catch (error) {
    assistantMessage.pending = false;
    assistantMessage.error = true;
    assistantMessage.content = `Không thể kết nối tới mô hình.\n\n**Chi tiết:** ${error.message}`;
  } finally {
    window.clearInterval(thinkingTimer);
    assistantMessage.pending = false;
    assistantMessage.streaming = false;
    delete assistantMessage.thinkingSeconds;
    delete assistantMessage.rawContent;
    isLoading = false;
    elements['model-select'].disabled = false;
    elements.send.disabled = !elements.prompt.value.trim();
    render();
    try {
      await api(`/messages/${encodeURIComponent(assistantMessage.id)}`, { method: 'PATCH', body: JSON.stringify({ profile: currentProfile, content: assistantMessage.content }) });
    } catch (error) {
      assistantMessage.error = true;
      assistantMessage.syncError = error.message;
      render();
    }
    activeStream = null;
  }
}

async function retryMessage(messageId) {
  if (isLoading || !currentModel) return;
  const conversation = activeConversation();
  const index = conversation?.messages.findIndex(message => message.id === messageId) ?? -1;
  const assistantMessage = conversation?.messages[index];
  if (index < 1 || assistantMessage?.role !== 'assistant') return;

  Object.assign(assistantMessage, { content: '', rawContent: '', pending: true, streaming: false, thinkingSeconds: 0 });
  delete assistantMessage.error;
  isLoading = true;
  elements['model-select'].disabled = true;
  updateSendState();
  render({ scrollToEnd: true });

  const thinkingTimer = window.setInterval(() => {
    if (!assistantMessage.pending) return;
    assistantMessage.thinkingSeconds += 1;
    const timer = elements.messages.querySelector(`[data-thinking-time="${assistantMessage.id}"]`);
    if (timer) timer.textContent = ` · ${assistantMessage.thinkingSeconds}s`;
  }, 1000);

  try {
    const previousUserMessage = conversation.messages[index - 1];
    const attachments = messageAttachments.get(previousUserMessage.id) || [];
    if (previousUserMessage.attachmentNames?.length && !attachments.length) {
      throw new Error('Nội dung file không còn trong bộ nhớ. Vui lòng đính kèm lại tài liệu rồi gửi lại.');
    }
    await streamResponse(conversation.messages.slice(0, index), assistantMessage, attachments, { profile: currentProfile, conversationId: conversation.id });
  } catch (error) {
    assistantMessage.pending = false;
    assistantMessage.error = true;
    assistantMessage.content = `Không thể kết nối tới mô hình.\n\n**Chi tiết:** ${error.message}`;
  } finally {
    window.clearInterval(thinkingTimer);
    assistantMessage.pending = false;
    assistantMessage.streaming = false;
    delete assistantMessage.thinkingSeconds;
    delete assistantMessage.rawContent;
    isLoading = false;
    elements['model-select'].disabled = false;
    updateSendState();
    render();
    try {
      await api(`/messages/${encodeURIComponent(assistantMessage.id)}`, { method: 'PATCH', body: JSON.stringify({ profile: currentProfile, content: assistantMessage.content }) });
    } catch (error) {
      assistantMessage.error = true;
      assistantMessage.syncError = error.message;
      render();
    }
    activeStream = null;
  }
}

elements.composer.addEventListener('submit', submitPrompt);
elements.prompt.addEventListener('input', () => {
  elements.prompt.style.height = 'auto';
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 200)}px`;
  updateSendState();
});
elements.attach.addEventListener('click', () => elements['file-input'].click());
elements['file-input'].addEventListener('change', async event => {
  const slots = Math.max(0, 5 - pendingAttachments.length);
  for (const file of [...event.target.files].slice(0, slots)) await uploadAttachment(file);
  event.target.value = '';
});
document.addEventListener('paste', async event => {
  if (isLoading || !currentProfile) return;
  const images = [...(event.clipboardData?.items || [])]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  const slots = Math.max(0, 5 - pendingAttachments.length);
  for (const [index, image] of images.slice(0, slots).entries()) {
    const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const file = new File([image], `clipboard-${Date.now()}-${index + 1}.${extension}`, { type: image.type });
    await uploadAttachment(file);
  }
});
elements['attachment-list'].addEventListener('click', event => {
  const retryButton = event.target.closest('[data-retry-file]');
  if (retryButton && !isLoading) {
    retryAttachment(Number(retryButton.dataset.retryFile));
    return;
  }
  const button = event.target.closest('[data-remove-file]');
  if (!button || isLoading) return;
  pendingAttachments.splice(Number(button.dataset.removeFile), 1);
  renderAttachments();
});
elements.prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});
elements['new-chat'].addEventListener('click', async () => {
  if (isLoading) return;
  startNewConversation();
  elements.sidebar.classList.remove('open');
});
elements['history-list'].addEventListener('click', async event => {
  if (isLoading) return;
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    await deleteConversation(deleteButton.dataset.delete);
    return;
  }
  const item = event.target.closest('[data-id]');
  if (!item) return;
  activeId = item.dataset.id;
  setConversationUrl(activeId);
  pendingAttachments = [];
  renderAttachments();
  elements.sidebar.classList.remove('open');
  render({ scrollToEnd: true, revealAtEnd: true });
});
elements.messages.addEventListener('click', async event => {
  const retryButton = event.target.closest('[data-retry-message]');
  if (retryButton) {
    await retryMessage(retryButton.dataset.retryMessage);
    return;
  }
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const message = activeConversation()?.messages.find(item => item.id === button.dataset.copy);
  if (message) await navigator.clipboard.writeText(message.content);
  button.textContent = 'Đã sao chép';
});
elements['theme-toggle'].addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  updateThemeIcon();
});
elements['mobile-menu'].addEventListener('click', () => elements.sidebar.classList.toggle('open'));
elements['model-select'].addEventListener('change', event => {
  currentModel = event.target.value;
  localStorage.setItem(MODEL_KEY, currentModel);
  elements['app-version'].textContent = `${currentModel} · ${currentVersion}`;
});
elements['profile-button'].addEventListener('click', () => elements['profile-gate'].classList.remove('hidden'));
elements['profile-gate'].addEventListener('click', event => {
  const option = event.target.closest('[data-profile]');
  if (option) selectProfile(option.dataset.profile).catch(error => window.alert(`Không thể tải lịch sử: ${error.message}`));
});
window.addEventListener('popstate', () => {
  if (isLoading) return;
  const requestedId = conversationIdFromUrl();
  activeId = conversations.some(item => item.id === requestedId) ? requestedId : null;
  pendingAttachments = [];
  renderAttachments();
  render({ scrollToEnd: true, revealAtEnd: true });
});

fetch(`${API_BASE}/config`).then(async response => {
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}).then(config => {
  const models = Array.isArray(config.models) && config.models.length ? config.models : [config.model];
  const savedModel = localStorage.getItem(MODEL_KEY);
  currentModel = models.includes(savedModel) ? savedModel : config.model;
  currentVersion = config.version;
  maxFileSizeMb = config.maxFileSizeMb;
  elements['model-select'].replaceChildren(...models.map(model => new Option(model, model)));
  elements['model-select'].value = currentModel;
  elements['model-select'].disabled = false;
  elements['app-version'].textContent = `${currentModel} · ${config.version}`;
  updateSendState();
}).catch(error => {
  elements['app-version'].textContent = `Backend chưa kết nối · ${error.message}`;
});

loadProfileData().then(loaded => {
  if (loaded) {
    conversations = loaded.conversations;
    activeId = loaded.activeId;
    if (conversationIdFromUrl() && !activeId) setConversationUrl(null, { replace: true });
  }
  render({ scrollToEnd: true, revealAtEnd: true });
}).catch(error => {
  console.error('History load failed', error);
  render({ scrollToEnd: true, revealAtEnd: true });
});
setupScrollButton();
elements.prompt.focus();

async function uploadAttachment(file) {
  const attachment = { name: file.name, type: file.type, file, loading: true, error: '' };
  pendingAttachments.push(attachment);
  renderAttachments();
  if (file.type.startsWith('image/')) await readImageAttachment(attachment);
  else await extractAttachment(attachment);
}

async function retryAttachment(index) {
  const attachment = pendingAttachments[index];
  if (!attachment?.file || attachment.loading) return;
  attachment.loading = true;
  attachment.error = '';
  renderAttachments();
  if (attachment.type.startsWith('image/')) await readImageAttachment(attachment);
  else await extractAttachment(attachment);
}

async function readImageAttachment(attachment) {
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  try {
    if (!supportedTypes.has(attachment.type)) throw new Error('Ảnh phải có định dạng JPEG, PNG, WebP hoặc GIF.');
    if (attachment.file.size > maxFileSizeMb * 1024 * 1024) throw new Error(`Ảnh vượt quá giới hạn ${maxFileSizeMb} MB.`);
    attachment.imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Không thể đọc ảnh.'));
      reader.readAsDataURL(attachment.file);
    });
    attachment.loading = false;
  } catch (error) {
    Object.assign(attachment, { loading: false, error: error.message });
  }
  renderAttachments();
}

async function extractAttachment(attachment) {
  const formData = new FormData();
  formData.append('file', attachment.file);
  try {
    const response = await fetch(`${API_BASE}/files/extract`, { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    Object.assign(attachment, { content: result.text, loading: false, truncated: result.truncated });
  } catch (error) {
    Object.assign(attachment, { loading: false, error: error.message });
  }
  renderAttachments();
}

function renderAttachments() {
  elements['attachment-list'].classList.toggle('hidden', pendingAttachments.length === 0);
  elements['attachment-list'].innerHTML = pendingAttachments.map((file, index) => `<div class="attachment-chip ${file.error ? 'error' : ''} ${file.imageUrl ? 'image' : ''}">${file.imageUrl ? `<img src="${file.imageUrl}" alt="">` : ''}<span>${escapeHtml(file.name)}</span><small>${file.loading ? 'Đang đọc...' : file.error || (file.imageUrl ? 'Ảnh' : file.truncated ? 'Đã đọc · rút gọn' : 'Đã đọc')}</small><div class="attachment-actions">${file.error ? `<button type="button" data-retry-file="${index}" aria-label="Thử đọc lại" title="Thử lại">${icons.retry}</button>` : ''}<button type="button" data-remove-file="${index}" aria-label="Bỏ file" title="Bỏ file">${icons.close}</button></div></div>`).join('');
  updateSendState();
}

function updateSendState() {
  elements.send.disabled = !currentModel || isLoading || pendingAttachments.some(file => file.loading) || (!elements.prompt.value.trim() && !pendingAttachments.some(file => file.content || file.imageUrl));
}

function isNearBottom(container, threshold = 120) {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function scrollToBottom(container, smooth = true) {
  if (smooth) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    return;
  }
  const scrollBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = 'auto';
  container.scrollTop = container.scrollHeight;
  container.style.scrollBehavior = scrollBehavior;
}

function setupScrollButton() {
  const button = elements['scroll-bottom'];
  button.addEventListener('click', () => scrollToBottom(elements.messages));
  const toggle = () => {
    button.classList.toggle('hidden', isNearBottom(elements.messages));
  };
  elements.messages.addEventListener('scroll', toggle, { passive: true });
  new ResizeObserver(toggle).observe(elements.messages);
  toggle();
}
