# 🔑 שירותים בשימוש בפרויקט

מסמך מרכזי לכל השירותים החיצוניים שהפרויקט תלוי בהם, וחשבון המשתמש המשויך לכל אחד — כדי שלא נאבד גישה בעתיד.

| שירות | תפקיד בפרויקט | חשבון / יוזר |
|---|---|---|
| **GitHub** | אירוח קוד המקור (`AzMaVeZe/MitHaze`), Pull Requests, GitHub Actions (CI/CD) | יוזר: **AZMAVEZE** · מייל commit/login: `ariel.zitnitski@gmail.com` |
| **Render** | אירוח השרת החי (Node.js + Socket.IO) בכתובת `mithaze.onrender.com`, כולל Deploy Hook שמופעל אוטומטית מ-GitHub Actions בכל push ל-`main` | מייל: `ariel.zitnitski@gmail.com` |
| **GoDaddy** | רישום הדומיין הראשי `azma.app` (משמש לכל האפליקציות; `mithaze` היא תת-הדומיין של המשחק הזה) | מייל: `vezeazma@gmail.com` |
| **Google Search Console** | אימות בעלות ואינדוקס של `mithaze.azma.app` בחיפוש גוגל (קובץ אימות: `public/google94a43c73c2506559.html`) | חשבון גוגל: `vezeazma@gmail.com` |
| **Google Play Console** | פרסום האפליקציה כ-Android App (TWA), חבילה `com.mithaze.app` | חשבון גוגל: `vezeazma@gmail.com` |
| **PWABuilder.com** | יצירת חבילת ה-Android (AAB/APK) + מפתח החתימה (`signing.keystore`) מתוך ה-PWA | לא דורש התחברות — כלי ציבורי חינמי |
| **Google Fonts** | טעינת גופן Heebo (עברי) בעמוד הראשי ובעמוד מדיניות הפרטיות | לא חשבון — משאב סטטי ציבורי (CDN), ללא מעקב/אנליטיקס |

## הערות חשובות

- **מפתח החתימה של Android** (`signing.keystore`, סיסמה `X2P6oMKEHzhn`, alias `my-key-alias`) **חייב להישמר** — הוא נדרש לכל עדכון עתידי של האפליקציה ב-Google Play. Play Console נועל את המפתח מרגע ההעלאה הראשונה ולא ניתן להחליפו. הקובץ **לא** נמצא בריפו (מטעמי אבטחה) — נשלח למשתמש ישירות דרך הצ'אט.
- **`RENDER_DEPLOY_HOOK`** — סוד שמור ב-GitHub Actions (Settings → Secrets) המחבר בין GitHub ל-Render לצורך פריסה אוטומטית. לא מוצג כאן מטעמי אבטחה.
- אין באפליקציה עצמה שירותי אנליטיקס, פרסום, מסדי נתונים חיצוניים או אחסון בענן — כל מצב המשחק נשמר בזיכרון השרת בלבד (ראו `public/privacy.html`).
