# פריסה ל-Firebase Hosting

מדריך שלב-אחר-שלב לאירוח TripAI. כל הפקודות רצות מתוך `c:\My Apps\travel-app`.

---

## שלב 0 — התקנת Node.js (חובה, עדיין לא מותקן במחשב)

בדקתי — אין Node במחשב. גם ה-build וגם ה-Firebase CLI לא יעבדו בלעדיו.

1. הורד את גרסת **LTS** מ-https://nodejs.org
2. הרץ את המתקין, השאר את כל ברירות המחדל מסומנות
3. **סגור ופתח מחדש את הטרמינל** (PATH מתעדכן רק בטרמינל חדש)
4. אמת:

```powershell
node -v
npm -v
```

צריך להחזיר משהו כמו `v22.x.x` ו-`10.x.x`. אם לא — הטרמינל לא נפתח מחדש.

---

## שלב 1 — התקנת התלויות והרצה מקומית

```powershell
npm install
npm run dev
```

הדפדפן ייפתח על http://localhost:5173. ודא שכל 5 הטאבים עובדים לפני שממשיכים.
לעצירה: `Ctrl+C`.

---

## שלב 2 — התקנת Firebase CLI

```powershell
npm install -g firebase-tools
firebase --version
```

אם PowerShell חוסם את הסקריפט עם שגיאת execution policy, הרץ פעם אחת:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

---

## שלב 3 — התחברות לחשבון Google

```powershell
firebase login
```

נפתח דפדפן. התחבר עם החשבון שבו תרצה שהפרויקט יישב.
לאימות: `firebase projects:list`

---

## שלב 4 — יצירת פרויקט ב-Firebase

1. היכנס ל-https://console.firebase.google.com
2. **Add project** → תן שם, למשל `tripai`
3. Google Analytics — אפשר לכבות, לא נדרש לאירוח
4. המתן ליצירה, ורשום לעצמך את ה-**Project ID** (למשל `tripai-4f2a1`) —
   הוא לא בהכרח זהה לשם שנתת

---

## שלב 5 — חיבור התיקייה לפרויקט

```powershell
firebase use --add
```

בחר את הפרויקט מהרשימה, ותן לו alias `default`.
זה יוצר קובץ `.firebaserc` — הוא כן נכנס ל-git.

> `firebase.json` כבר מוכן בריפו (public=`dist`, rewrite של SPA, וכללי cache),
> אז **אין צורך להריץ `firebase init`**. אם בכל זאת תריץ אותו — הוא ישאל אם
> לדרוס את `firebase.json`, ענה **No**.

---

## שלב 6 — Build

```powershell
npm run build
```

נוצרת תיקיית `dist/`. לבדיקה מקומית של הבנייה לפני העלאה:

```powershell
npm run preview
```

---

## שלב 7 — פריסה

```powershell
firebase deploy --only hosting
```

בסיום תקבל שתי כתובות:

```
https://<project-id>.web.app
https://<project-id>.firebaseapp.com
```

שתיהן HTTPS עם תעודה אוטומטית. זהו — האתר באוויר.

---

## עדכון גרסה

בכל שינוי בקוד:

```powershell
npm run build
firebase deploy --only hosting
```

### תצוגה מקדימה לפני שחרור

```powershell
firebase hosting:channel:deploy preview
```

מייצר URL זמני (7 ימים) בלי לגעת בגרסה החיה. שימושי לשליחה למישהו לאישור.

### חזרה לגרסה קודמת

ב-Console → Hosting → Release history → שלוש נקודות ליד גרסה → **Rollback**.

---

## מפתח Google Maps — קרא לפני שמוסיפים

Vite **מטמיע** כל משתנה `VITE_*` בתוך ה-JS הסופי. כלומר המפתח יהיה גלוי לכל מי
שיפתח את קוד המקור של האתר. זה לא באג — ככה מפתחות Static Maps עובדים בצד לקוח.
ההגנה היא הגבלת המפתח, לא הסתרתו:

1. צור `.env.local` (כבר ב-`.gitignore`, לא ייכנס לגיט):

   ```
   VITE_GOOGLE_MAPS_KEY=AIza...
   ```

2. ב-Google Cloud Console → APIs & Services → Credentials → המפתח שלך:
   - **Application restrictions** → HTTP referrers
   - הוסף: `https://<project-id>.web.app/*` ו-`https://<project-id>.firebaseapp.com/*`
   - להרצה מקומית הוסף גם `http://localhost:5173/*`
   - **API restrictions** → הגבל ל-**Maps Static API** בלבד
3. ב-Cloud Console → Billing → הגדר **budget alert**, כי לכל בקשת מפה יש עלות

בלי מפתח האפליקציה עובדת מצוין — היא מציירת מפת SVG כהה משלה.

---

## דומיין משלך (אופציונלי)

Console → Hosting → **Add custom domain** → הזן את הדומיין → Firebase ייתן לך
רשומות `A` (או `TXT` לאימות) להוסיף אצל רשם הדומיין. התעודה מונפקת אוטומטית
תוך כמה שעות.

---

## פריסה אוטומטית מ-GitHub (אופציונלי)

```powershell
firebase init hosting:github
```

מחבר את הריפו, יוצר Service Account ושומר אותו כ-secret, ומייצר שני workflows:
פריסה ל-live בכל merge ל-main, ו-preview channel לכל Pull Request.

---

## תקלות נפוצות

| תסמין | סיבה וטיפול |
|---|---|
| `firebase: command not found` | הטרמינל לא נפתח מחדש אחרי `npm install -g` |
| דף לבן ריק אחרי deploy | `public` ב-`firebase.json` לא מצביע ל-`dist`, או ש-`npm run build` לא רץ |
| רענון בנתיב פנימי מחזיר 404 | ה-`rewrites` הוסר מ-`firebase.json` — הוא מה שמפנה הכל ל-`index.html` |
| המפה ריקה / אפורה | המפתח לא הוגבל נכון ל-referrer, או שה-Maps Static API לא הופעל בפרויקט |
| שינויים לא מופיעים | cache של הדפדפן — רענון קשיח `Ctrl+Shift+R` |
