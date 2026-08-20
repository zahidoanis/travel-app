# TripAI

עוזר נסיעות חכם בעברית — אב-טיפוס אינטראקטיבי של אפליקציית מובייל, בנוי ב-React + Vite.

## הרצה

```bash
npm install
npm run dev
```

נפתח ב-http://localhost:5173. הדפדפן מציג מסגרת מכשיר במסכים רחבים ומסך מלא במובייל.

## תלויות

`react`, `react-dom`, `vite`, `@vitejs/plugin-react` — וזהו. האייקונים הם SVG inline
(`src/components/Icons.jsx`, בסגנון lucide) והעיצוב הוא CSS עם design tokens, כדי
שלא תהיה שום תלות שיכולה להישבר בהתקנה.

## מבנה

```
src/
├── main.jsx              נקודת כניסה
├── App.jsx               מעטפת: onboarding → 5 טאבים
├── styles.css            design system (tokens, RTL, glassmorphism)
├── data.js               נתוני mock: טיול, עצירות, חברי קבוצה, שערים, הוצאות
├── lib/staticMap.js      בונה URL יחיד ל-Google Static Maps
├── components/
│   ├── Icons.jsx         סט אייקונים inline SVG
│   ├── TopBar.jsx        3 וריאציות: home / centered / brand
│   ├── BottomNav.jsx     בר ניווט צף עם 5 טאבים
│   ├── Sheet.jsx         bottom-sheet מודאלי
│   └── MapCanvas.jsx     מפת SVG כהה, או Google Static Maps אם יש מפתח
└── screens/
    ├── Onboarding.jsx    3 שלבים, בחירת סגנון + תקציב, סוכן AI צף
    ├── Home.jsx          דשבורד יומי, ציר זמן, המלצות
    ├── MapScreen.jsx     מפה מלאה + קרוסלת עצירות מסונכרנת עם הפינים
    ├── Chat.jsx          התראת עיכוב טיסה → הצעת ניתוב מחדש → אישור
    ├── Gallery.jsx       באנר סרטון סיכום + מודאל התאמה + masonry
    └── Finance.jsx       ממיר מטבע חי + חלוקת הוצאות קבוצתית
```

## מפות

ברירת המחדל היא מפת SVG מסוגננת — עובדת ללא הגדרות ובלי מפתח API.
כדי לעבור למפות אמיתיות של Google, צור `.env.local`:

```
VITE_GOOGLE_MAPS_KEY=AIza...
```

`MapCanvas` יזהה את המפתח ויעבור אוטומטית ל-Static Maps.
כל בניית ה-URL עוברת דרך `buildStaticMapUrl()` בלבד — שם מרוכזים ה-`style=` המשותף,
`scale=2`, עיגול הקואורדינטות ל-5 ספרות (כדי שאותו מבט ייתן אותו URL וייכנס ל-cache),
ובדיקת מגבלת 16,384 התווים. הגבל את המפתח לפי HTTP referrer ב-Google Cloud Console.

הנחיות העיצוב המלאות: [prompts/google-static-maps-design.md](prompts/google-static-maps-design.md)

## מה אינטראקטיבי

- מעבר בין 5 הטאבים, ו-onboarding שזורם ל-Home
- בחירת סגנונות טיול (מרובה) ותקציב (יחיד)
- לחיצה על פין במפה מזיזה את הקרוסלה, ולהפך
- אישור שינוי הרכבת בצ'אט → מצב "אושר" + תשובת סוכן מושהית
- שליחת הודעה בצ'אט → אינדיקטור הקלדה → תשובה
- מודאל סרטון סיכום: מוזיקה, אורך (slider), סגנון, וסימולציית רינדור
- ממיר מטבע: 8 מטבעות, כפתור החלפה, חישוב חי דרך ILS
- הוספת הוצאה קבוצתית → מתעדכן ב"סה"כ הוצאות" ובמאזן החובות

## הערות

- נתוני השערים ב-`data.js` הם אינדיקטיביים בלבד; בפרודקשן הם מגיעים מ-API שערים.
- התמונות בגלריה ובציר הזמן הן גרדיאנטים של CSS, כדי לא לבקש קבצים חיצוניים.
  להחלפה בתמונות אמיתיות — `PHOTOS` ב-`data.js` ו-`THUMB` ב-`Home.jsx`.
