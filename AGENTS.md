# Repository Rules

- Never commit or push changes unless the user explicitly requests that exact action.
- Never trigger, rerun, cancel, or otherwise modify remote CI/CD workflows unless the user explicitly requests it.
- Never publish images, packages, releases, or deployments unless the user explicitly requests it.
- Never bump application, add-on, image, package, or release versions unless the user explicitly requests it.
- Never run a local production build unless the user explicitly requests it. Linting and targeted tests are allowed when needed to verify code changes.
- An instruction to implement or test a change does not imply permission to commit, push, publish, deploy, bump versions, or trigger remote builds.
