# Auth Testing Guide — BuildManager VIC

How automated tests authenticate against this app.

## Login (sets httpOnly cookies)
```
API_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d '=' -f2)
curl -c /tmp/cookies.txt -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"pm@buildmanagervic.com.au","password":"SitePM-2026"}'
```
Response: user object. Cookies set: `access_token` (15 min JWT), `refresh_token` (7 days JWT), samesite=lax, path=/.

## Authenticated requests
Cookie-based (preferred, matches browser behaviour):
```
curl -b /tmp/cookies.txt "$API_URL/api/auth/me"
curl -b /tmp/cookies.txt "$API_URL/api/projects"
```
Bearer fallback also works: extract `access_token` value from the cookie jar and send `Authorization: Bearer <token>`.

## Other endpoints
- POST /api/auth/register {name, email, password>=8 chars} → creates account + sets cookies
- POST /api/auth/refresh (uses refresh_token cookie) → new access_token cookie
- POST /api/auth/logout (authenticated) → clears cookies
- Unauthenticated access to protected routes → 401 JSON {detail: "Not authenticated"}
- 5 failed logins for same ip:email → 429 lockout for 15 min (avoid triggering in tests; use correct password)

## Browser/Playwright testing
- Frontend at REACT_APP_BACKEND_URL root. Unauthenticated visits to protected pages redirect to /login.
- Login form data-testids: login-email-input, login-password-input, login-submit-button (register-* equivalents on Register tab).
- Cookies are same-origin; Playwright context keeps the session automatically after login.

## MongoDB verification
```
mongosh
use test_database
db.users.findOne({email: "pm@buildmanagervic.com.au"})   // password_hash starts with $2b$
```

## Step-by-step API smoke test
```
curl -c cookies.txt -X POST http://localhost:8001/api/auth/login -H "Content-Type: application/json" -d '{"email":"pm@buildmanagervic.com.au","password":"SitePM-2026"}'
cat cookies.txt
curl -b cookies.txt http://localhost:8001/api/auth/me
```
Login should return the user object and set `access_token` + `refresh_token` cookies. The `/me` call should return the same user using those cookies.
