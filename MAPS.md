# חיבור מפתח Google Maps Static API

האפליקציה עובדת בלי מפתח — היא מציירת מפת SVG כהה משלה. המדריך הזה מחליף אותה
במפות אמיתיות של Google.

---

## לפני שמתחילים — שתי נקודות

**1. נדרש חשבון חיוב עם כרטיס אשראי.** גם לשימוש בחינם. Google Maps Platform לא
מנפיק מפתח פעיל בלי billing account מקושר. יש מכסה חודשית חינמית ל-Static Maps,
אבל Google שינה את מודל התמחור ב-2025 — בדוק את המספרים העדכניים ב-
https://mapsplatform.google.com/pricing לפני שאתה מסתמך עליהם.

**2. המפתח יהיה גלוי בקוד המקור של האתר.** Vite מטמיע כל `VITE_*` בתוך ה-JS
הסופי. זה לא באג — ככה מפתחות client-side עובדים. ההגנה היא **הגבלת המפתח**
(שלב 5), לא הסתרתו. אל תדלג על שלב 5.

---

## שלב 1 — פתח את הפרויקט ב-Google Cloud Console

פרויקט Firebase **הוא** פרויקט Google Cloud, אז אין צורך ליצור חדש.

1. היכנס ל-https://console.cloud.google.com
2. בורר הפרויקטים למעלה → בחר את הפרויקט שיצרת ב-Firebase (למשל `tripai-4f2a1`)
3. ודא שה-Project ID בראש הדף תואם

---

## שלב 2 — הפעל חיוב

1. תפריט צד → **Billing**
2. **Link a billing account** → אם אין לך, **Create billing account** והזן כרטיס
3. חזור לפרויקט וודא שכתוב **Billing is enabled**

> אם תדלג על השלב הזה, המפה תיטען אבל עם סימן מים אפור
> **"For development purposes only"** על כל התמונה. זה הסימן החד-משמעי
> ש-billing לא מקושר.

---

## שלב 3 — הפעל את ה-API

1. תפריט צד → **APIs & Services** → **Library**
2. חפש **Maps Static API**
3. לחץ עליו → **Enable**

חשוב: זה ה-API היחיד שנדרש. **לא** "Maps JavaScript API" ולא "Maps Embed API" —
האפליקציה מבקשת תמונות, לא מפה אינטראקטיבית.

---

## שלב 4 — צור את המפתח

1. **APIs & Services** → **Credentials**
2. **+ Create credentials** → **API key**
3. המפתח מוצג בחלון קופץ — העתק אותו עכשיו (מתחיל ב-`AIza`)
4. אל תסגור לפני שהעתקת; אפשר תמיד לראות אותו שוב ברשימת ה-Credentials

---

## שלב 5 — הגבל את המפתח (אל תדלג)

ברשימת Credentials → לחץ על שם המפתח → ערוך:

### Application restrictions

בחר **Websites**, והוסף את כל אלה:

```
http://localhost:5173/*
https://<project-id>.web.app/*
https://<project-id>.firebaseapp.com/*
```

החלף `<project-id>` ב-Project ID האמיתי שלך. אם יש דומיין משלך — הוסף גם אותו.

> הוסף את `localhost` כבר עכשיו, אחרת הפיתוח המקומי ייכשל ותחשוב שהמפתח שבור.

### API restrictions

בחר **Restrict key** → סמן **Maps Static API** בלבד → **Save**.

השינוי יכול לקחת עד כמה דקות להיכנס לתוקף.

---

## שלב 6 — הגדר תקציב והתראה

לכל בקשת מפה יש עלות. בלי גבול, באג בלולאה יכול לייצר חשבון מפתיע.

1. **Billing** → **Budgets & alerts** → **Create budget**
2. סכום חודשי שנוח לך איתו (למשל 5$)
3. סמן התראות ב-50% / 90% / 100%

---

## שלב 7 — חבר את המפתח לאפליקציה

צור קובץ בשם `.env.local` בשורש הפרויקט (`c:\My Apps\travel-app`):

```
VITE_GOOGLE_MAPS_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

בלי גרשיים, בלי רווחים סביב ה-`=`.

הקובץ כבר ב-`.gitignore` — הוא לא ייכנס לגיט.

---

## שלב 8 — הפעל מחדש והרץ

**Vite קורא משתני סביבה רק באתחול.** אם שרת הפיתוח רץ, `Ctrl+C` והפעל מחדש:

```powershell
npm run dev
```

עבור לטאב **מפה**. אמור לראות מפה כהה מסוגננת של פריז עם 4 סמנים ממוספרים וקו
מסלול ציאן. החלפת כרטיס בקרוסלה תמרכז את המפה מחדש על העצירה.

---

## אימות שזה באמת עובד

פתח DevTools (`F12`) → **Network** → סנן `staticmap`:

| מה רואים | מה זה אומר |
|---|---|
| `200` ותמונה תקינה | הכל עובד |
| `403` | ה-referrer לא מורשה — בדוק את שלב 5, וודא שהכתובת בדפדפן תואמת בדיוק |
| סימן מים "For development purposes only" | billing לא מקושר — שלב 2 |
| `REQUEST_DENIED` בגוף התשובה | ה-Maps Static API לא הופעל — שלב 3 |
| עדיין מפת SVG ולא צילום | `.env.local` לא נקרא — שם הקובץ, שם המשתנה, או שהשרת לא הופעל מחדש |

---

## פריסה עם המפתח

```powershell
npm run build
firebase deploy --only hosting
```

ה-build מטמיע את המפתח מ-`.env.local`. אחרי הפריסה בדוק שהמפה עולה גם בכתובת
החיה — אם לא, כמעט תמיד זה ה-referrer restriction שלא כולל את דומיין Firebase.

> **בפריסה מ-CI** (GitHub Actions) אין `.env.local`. הוסף את המפתח כ-repository
> secret והזרק אותו כמשתנה סביבה בשלב ה-build:
> `env: VITE_GOOGLE_MAPS_KEY: ${{ secrets.VITE_GOOGLE_MAPS_KEY }}`

---

## איך זה בנוי בקוד

כל בניית URL עוברת דרך פונקציה אחת — [`buildStaticMapUrl()`](src/lib/staticMap.js).
שם מרוכזים:

- **`style=` משותף** — כל המפות באפליקציה נראות זהות ותואמות לפלטה
- **`scale=2`** — רזולוציית retina, מחויב כבקשה אחת
- **עיגול ל-5 ספרות** — אותו מבט מייצר אותו URL בדיוק, ולכן נכנס ל-cache של
  הדפדפן במקום להיות מחויב שוב
- **`path=`** — קו המסלול. כרגע קווים ישרים בין העצירות; למסלול שעוקב אחרי רחובות
  אמיתיים צריך polyline מקודד מ-Directions API
- **בדיקת 16,384 תווים** — המגבלה הקשיחה של Static Maps

`MapCanvas` בודק `hasMapsKey` ומחליף בין המפה האמיתית ל-SVG אוטומטית.

**שים לב לעלות:** מרכוז מחדש בכל החלפת כרטיס = בקשה נפרדת לכל עצירה (4 סה"כ,
ואז cache). אם תרצה תמונה אחת בלבד לכל המסלול, החלף ב-`MapCanvas` את
`center`/`zoom` ב-`visible: stops.map(s => [s.lat, s.lng])` — Google יתאים את
הגבולות אוטומטית, במחיר של ויתור על אפקט המרכוז.
