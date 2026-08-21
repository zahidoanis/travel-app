# מצב הפריסה

מה חי כרגע. מתעדכן ככל שמתקדמים.

**האתר: https://travel-ai-6de47.web.app**

---

## פעיל

| רכיב | כתובת / מזהה | מאומת |
|---|---|---|
| **האתר** | `https://travel-ai-6de47.web.app` | ✔ |
| **פרויקט Firebase** | `travel-ai-6de47` | ✔ |
| **Firestore** | `(default)`, Standard edition | ✔ |
| **הזדהות אנונימית** | מונפק uid לכל מכשיר | ✔ |
| **כללי אבטחה** | `firebase.rules` | ✔ נאכפים |
| **פרוקסי Gemini** | `https://tripai-ai.tripai-app.workers.dev` | ✔ |
| **דגם** | `gemini-3.6-flash` | ✔ |

---

## איך מאמתים שהכול עדיין עובד

```bash
npm run fb:check       # הזדהות + כללי אבטחה משני הכיוונים
npm run worker:check -- https://tripai-ai.tripai-app.workers.dev
npm run ai:check       # מפתח Gemini והדגם
```

`fb:check` הוא הבדיקה שכדאי להריץ אחרי כל שינוי בכללים. הוא מנסה לכתוב למסמך
של משתמש אחר ומצפה לסירוב, ואז למסמך של עצמו ומצפה להצלחה — כלומר בודק גם
שהכללים לא נפתחו מדי וגם שלא נסגרו מדי. בדיקה חד-צדדית לא הייתה תופסת אף אחד
מהשניים.

---

## מה נמצא בכל bundle שנבנה

נבדק אחרי כל build:

| | |
|---|---|
| קונפיג Firebase | **נמצא** — מיועד להיות ציבורי |
| כתובת ה-Worker | **נמצאת** — לא סוד, ה-allowlist מגן |
| מפתח Gemini | **נעדר** — יושב כ-secret אצל Cloudflare בלבד |

---

## עדכון גרסה

```bash
npm run build
firebase deploy --only hosting
```

דורש אימות: `firebase login`, או משתנה `GOOGLE_APPLICATION_CREDENTIALS` שמצביע
לקובץ Service Account.

### כותרות cache

`firebase.json` מגדיר שני משטרים:

| נתיב | Cache-Control |
|---|---|
| `/assets/**` | `max-age=31536000, immutable` — שמות הקבצים כוללים hash |
| `/`, `/index.html`, כל נתיב בלי סיומת | `no-cache, no-store, must-revalidate` |

הכלל השני חייב לכלול את `/` ואת הנתיבים חסרי הסיומת במפורש. Firestore מתאים
`source` מילולית, אז כלל שמכוון רק ל-`/index.html` **לא** תופס את הכתובת שאליה
משתמשים באמת נכנסים — והם היו מקבלים `max-age=3600` של Firebase, כלומר עדכון
שלא מופיע במשך שעה.

---

## הרשאות זמניות שכדאי לבטל

| מה | איפה | מתי |
|---|---|---|
| **Service Account key** | [Project settings → Service accounts](https://console.firebase.google.com/project/travel-ai-6de47/settings/serviceaccounts/adminsdk) | עכשיו — הפריסה הסתיימה |
| **טוקן API של Cloudflare** | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) | עכשיו |

שניהם שימשו להעלאה בלבד. האתר וה-Worker ממשיכים לרוץ בלעדיהם.

**Service Account key הוא החזק מבין השניים** — הוא נותן שליטה מלאה בפרויקט
Firebase. מחיקתו מבטלת אותו לצמיתות.
