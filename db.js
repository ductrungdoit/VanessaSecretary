import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// HAOS persists /data; local dev uses ./data
const dataDir = fs.existsSync('/data') ? '/data' : path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'vanessa.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_profile ON conversations(profile, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    attachment_names TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);
`);

const stmts = {
  listConversations: db.prepare('SELECT id, profile, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE profile = ? ORDER BY updated_at DESC'),
  getConversation: db.prepare('SELECT id, profile, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id = ?'),
  insertConversation: db.prepare('INSERT INTO conversations (id, profile, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
  updateConversationTitle: db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?'),
  touchConversation: db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?'),
  deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
  listMessages: db.prepare('SELECT id, role, content, attachment_names AS attachmentNames, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'),
  insertMessage: db.prepare('INSERT INTO messages (id, conversation_id, role, content, attachment_names, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  updateMessageContent: db.prepare('UPDATE messages SET content = ? WHERE id = ?'),
  messageExists: db.prepare('SELECT 1 FROM messages WHERE id = ?'),
};

export function listConversations(profile) {
  return stmts.listConversations.all(profile.toLowerCase());
}

export function getConversation(id) {
  return stmts.getConversation.get(id) || null;
}

export function createConversation({ id, profile, title, createdAt }) {
  const now = createdAt || Date.now();
  stmts.insertConversation.run(id, profile.toLowerCase(), title || '', now, now);
  return { id, profile: profile.toLowerCase(), title: title || '', createdAt: now, updatedAt: now };
}

export function updateConversationTitle(id, title) {
  stmts.updateConversationTitle.run(title, Date.now(), id);
}

export function deleteConversation(id) {
  stmts.deleteConversation.run(id);
}

export function listMessages(conversationId) {
  return stmts.listMessages.all(conversationId).map(row => ({
    ...row,
    attachmentNames: parseAttachmentNames(row.attachmentNames),
  }));
}

function parseAttachmentNames(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(name => typeof name === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function addMessage({ id, conversationId, role, content, attachmentNames, createdAt }) {
  const now = createdAt || Date.now();
  stmts.insertMessage.run(id, conversationId, role, content || '', JSON.stringify(attachmentNames || []), now);
  stmts.touchConversation.run(now, conversationId);
  return { id, role, content: content || '', attachmentNames: attachmentNames || [], createdAt: now };
}

export function updateMessageContent(id, content, profile) {
  const conversation = getMessageConversation.get(id);
  if (!conversation || conversation.profile !== profile.toLowerCase()) return false;
  const changed = stmts.updateMessageContent.run(content, id).changes === 1;
  if (changed) stmts.touchConversation.run(Date.now(), conversation.conversationId);
  return changed;
}

const getMessageConversation = db.prepare('SELECT c.profile, c.id AS conversationId FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?');

export function getConversationForProfile(id, profile) {
  const conversation = getConversation(id);
  return conversation && conversation.profile === profile.toLowerCase() ? conversation : null;
}

export function updateConversationTitleForProfile(id, profile, title) {
  if (!getConversationForProfile(id, profile)) return false;
  return stmts.updateConversationTitle.run(title, Date.now(), id).changes === 1;
}

export function deleteConversationForProfile(id, profile) {
  if (!getConversationForProfile(id, profile)) return false;
  return stmts.deleteConversation.run(id).changes === 1;
}

export const addTurn = db.transaction(({ conversationId, profile, userMessage, assistantMessage, title }) => {
  if (!getConversationForProfile(conversationId, profile)) return false;
  const now = assistantMessage.createdAt || Date.now();
  stmts.insertMessage.run(userMessage.id, conversationId, 'user', userMessage.content || '', JSON.stringify(userMessage.attachmentNames || []), userMessage.createdAt || now);
  stmts.insertMessage.run(assistantMessage.id, conversationId, 'assistant', assistantMessage.content || '', '[]', assistantMessage.createdAt || now);
  if (title) stmts.updateConversationTitle.run(title, now, conversationId);
  else stmts.touchConversation.run(now, conversationId);
  return true;
});

// Import full conversations from localStorage in one transaction
export const importConversations = db.transaction((profile, conversations) => {
  const p = profile.toLowerCase();
  for (const conv of conversations) {
    if (!conv || typeof conv.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(conv.id)) continue;
    const existing = getConversation(conv.id);
    if (existing && existing.profile !== p) continue;
    const createdAt = conv.createdAt || Date.now();
    const msgs = Array.isArray(conv.messages) ? conv.messages : [];
    if (!existing) {
      const updatedAt = msgs.length ? msgs[msgs.length - 1].createdAt || createdAt : createdAt;
      stmts.insertConversation.run(conv.id, p, conv.title || '', createdAt, updatedAt);
    }
    for (const msg of msgs) {
      if (!msg || typeof msg.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(msg.id) || !['user', 'assistant'].includes(msg.role) || typeof msg.content !== 'string') continue;
      if (!stmts.messageExists.get(msg.id)) {
        const attachmentNames = Array.isArray(msg.attachmentNames) ? msg.attachmentNames.filter(name => typeof name === 'string').slice(0, 10) : [];
        stmts.insertMessage.run(msg.id, conv.id, msg.role, msg.content.slice(0, 1000000), JSON.stringify(attachmentNames), msg.createdAt || createdAt);
      }
    }
  }
});
