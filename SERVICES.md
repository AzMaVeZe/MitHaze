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

- **מפתח החתימה של Android** (`signing.keystore`) **חייב להישמר** — הוא נדרש לכל עדכון עתידי של האפליקציה ב-Google Play. הקובץ והסיסמה שלו **לא** נמצאים בריפו ואסור שיהיו בו (הריפו ציבורי). שמרו את שניהם במנהל סיסמאות + עותק גיבוי. אם המפתח אבד או דלף — Play App Signing מאפשר לבקש איפוס של מפתח ההעלאה (Upload key reset) ב-Play Console.
- **`RENDER_DEPLOY_HOOK`** — סוד שמור ב-GitHub Actions (Settings → Secrets) המחבר בין GitHub ל-Render לצורך פריסה אוטומטית. לא מוצג כאן מטעמי אבטחה.
- אין באפליקציה עצמה שירותי אנליטיקס, פרסום, מסדי נתונים חיצוניים או אחסון בענן — כל מצב המשחק נשמר בזיכרון השרת בלבד (ראו `public/privacy.html`).
