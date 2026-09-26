# Nomchael (local monorepo)

This Desktop folder is the combined local workspace.

For Railway shipping the app is split into two GitHub repos:

| App | Local folder | GitHub |
|-----|--------------|--------|
| Backend (NestJS API) | `Desktop/nomchael-api` | https://github.com/httpsarnold/nomchael |
| Frontend (Next.js) | `Desktop/nomchael-web` | Create `https://github.com/httpsarnold/nomchael-web` then push |

## Recommended rename on GitHub

Rename `httpsarnold/nomchael` → `nomchael-api` (Settings → General → Repository name) so the two repos read clearly as API vs web.

## After creating `nomchael-web`

```powershell
cd C:\Users\arnol\Desktop\nomchael-web
git remote remove origin 2>$null
git remote add origin https://github.com/httpsarnold/nomchael-web.git
git push -u origin main
```
