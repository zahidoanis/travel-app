# מצב הפריסה

מה חי כרגע, ומה עוד לא. מתעדכן ככל שמתקדמים.

---

## פעיל

| רכיב | כתובת / מזהה | מאומת |
|---|---|---|
| **פרויקט Firebase** | `travel-ai-6de47` | ✔ |
| **Firestore** | `(default)`, Standard edition | ✔ |
| **הזדהות אנונימית** | מונפק uid לכל מכשיר | ✔ |
| **כללי אבטחה** | `firebase.rules`, פורסמו מהקונסולה | ✔ נאכפים |
| **פרוקסי Gemini** | `https://tripai-ai.tripai-app.workers.dev` | ✔ |
| **דגם** | `gemini-3.6-flash` | ✔ |

## עדיין לא

| רכיב | חסם |
|---|---|
| **Firebase Hosting** | נדרש אימות ל-CLI — `firebase login` או Service Account |

---

## איך מאמתים שהכול עדיין עובד

```bash
npm run fb:check       # הזדהות + כללי אבטחה משני הכיוונים
npm run worker:check -- https://tripai-ai.tripai-app.workers.dev
npm run ai:check       # מפתח Gemini והדגם
```

`fb:check` הוא הבדיקה שכדאי להריץ אחרי כל שינוי בכללים. הוא מנסה לכתוב למסמך
של משתמש אחר ומצפה לסירוב, ואז למסמך של עצמו ומצפה להצלחה — כלומר בודק גם
שהכללים לא נפתחו מדי וגם שלא נסגרו מדי.

---

## מה נמצא בכל bundle שנבנה

נבדק אחרי כל build:

| | |
|---|---|
| קונפיג Firebase | **נמצא** — מיועד להיות ציבורי |
| כתובת ה-Worker | **נמצאת** — לא סוד, ה-allowlist מגן |
| מפתח Gemini | **נעדר** — יושב כ-secret אצל Cloudflare בלבד |

---

## הרשאות זמניות שכדאי לבטל

| מה | איפה | מתי |
|---|---|---|
| טוקן API של Cloudflare | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) | אחרי שהפריסה הסתיימה |
| Service Account key של Firebase | Project settings → Service accounts | מיד אחרי פריסת ה-Hosting, אם נוצר |

שניהם שימשו להעלאה בלבד. ה-Worker וה-Hosting ממשיכים לרוץ בלעדיהם.
