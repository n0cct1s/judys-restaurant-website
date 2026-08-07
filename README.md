# Judy's Sichuan Cuisine

Static restaurant site plus a small Node.js newsletter backend.

## Run the site

```bash
npm install
npm start
```

Open:

- Site: http://127.0.0.1:3000/
- Newsletter admin: http://127.0.0.1:3000/admin/

Default admin password: `judys-admin` (change in `.env`)

## Newsletter features

- Footer signup stores email + optional name in SQLite (`data/judys.db`)
- Each subscriber has a group/status: `subscribed`, `unsubscribed`, or `bounced`
- Admin can filter, update group, delete, and send one email to everyone in a group

## Send real emails

Edit `.env` with your SMTP settings (Hotmail/Outlook example):

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=judyssichuan@hotmail.com
SMTP_PASS=your-app-password
MAIL_FROM=Judy's Sichuan Cuisine <judyssichuan@hotmail.com>
```

Without SMTP, campaign sends run in dry-run mode and are logged in the server console.

## Quick test

1. Open the site footer and sign up with an email.
2. Open `/admin/`, log in with the admin password.
3. Confirm the subscriber appears under the `subscribed` group.
4. Use **Send to a Group** to email everyone in that group.
