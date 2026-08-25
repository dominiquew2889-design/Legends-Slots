/*
  LUCKY LEGENDS ARCADE - CLOUD CONFIG
  -----------------------------------
  The game works immediately in Guest Mode with no setup.

  To enable real player accounts + secure admin access:
  1. Create a Firebase project.
  2. Enable Email/Password Authentication.
  3. Create a Firestore database.
  4. Copy your Firebase web-app config below.
  5. Set ADMIN_EMAIL to YOUR email address.
  6. In Firebase Firestore Rules, paste the included firestore.rules file
     and replace the same admin email placeholder there.

  Firebase web configuration values are intended to be public in web apps.
*/

window.LUCKY_CONFIG = {
  ADMIN_EMAIL: "CHANGE-ME@example.com",

  FIREBASE_CONFIG: {
    apiKey: "PASTE_FIREBASE_API_KEY",
    authDomain: "PASTE_PROJECT.firebaseapp.com",
    projectId: "PASTE_PROJECT_ID",
    storageBucket: "PASTE_PROJECT.firebasestorage.app",
    messagingSenderId: "PASTE_SENDER_ID",
    appId: "PASTE_APP_ID"
  }
};
