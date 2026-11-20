// The only setting: the address of your Firebase Realtime Database (Firebase console -> Realtime Database -> Data tab).
window.SOCIALS_CONFIG = {
  databaseURL: 'https://conquer-socials-default-rtdb.firebaseio.com',
  // The address players see. That page (on the club's own site) shows this app inside it through wrap.js, so the
  // QR code on the TV and the players' phones show the club's address. Leave empty to use this site's own address.
  publicURL: 'https://go.playcnqr.com/socials',
  // "Speak the names": where the admin page sends a voice recording to be turned into a list of names (a scenario
  // in the club's Make account that asks Gemini; it only answers when the admin key is sent along). Empty = no button.
  voiceURL: 'https://hook.us2.make.com/ypi3egrcb7jmpqlc4f83ts7xim1op8ow'
};
