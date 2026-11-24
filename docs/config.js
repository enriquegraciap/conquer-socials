// The only setting: the address of your Firebase Realtime Database (Firebase console -> Realtime Database -> Data tab).
window.SOCIALS_CONFIG = {
  databaseURL: 'https://conquer-socials-default-rtdb.firebaseio.com',
  // The address players see. That page (on the club's own site) shows this app inside it through wrap.js, so the
  // QR code on the TV and the players' phones show the club's address. Leave empty to use this site's own address.
  publicURL: 'https://go.playcnqr.com/socials',
  // "Speak the names": where the admin page sends a voice recording to be turned into a list of names (a scenario
  // in the club's Make account that asks Gemini; it only answers when the admin key is sent along). Empty = no button.
  voiceURL: 'https://hook.us2.make.com/ypi3egrcb7jmpqlc4f83ts7xim1op8ow',
  // "Coming up" on the TV sign: each event gets a small QR code to its sign-up page. This is the start of that
  // address; the event's PlayByPoint program id is added to the end. Empty = no QR code on the sign.
  signupURL: 'https://app.playbypoint.com/programs/',
  // Other clubs. Each has its own pages (a folder of this site), its own part of the database with its own admin
  // key, and nothing in common with the first club: its events, TVs, flyers, leaderboards and ratings are its own.
  //   root: where its data lives in the database      dir: its folder on this site
  //   publicURL: the address its players see: the first club's page with ?c=<club> (wrap.js then shows this club's
  //              pages), or a page of its own on the club's site that loads <dir>wrap.js; empty = this site
  //   formats: the formats offered when an event is created there      courts: how many courts the club has
  clubs: {
    tempe: { name: 'Tempe', root: 'tempe', dir: 'tempe/', publicURL: 'https://go.playcnqr.com/socials?c=tempe', formats: ['kings-fixed', 'kings-individual', 'rr-individual', 'rr-fixed'], courts: 5 }
  }
};
