/* Padel Socials — "Intro to padel" on a phone: what people scan from the TV to read about the game. The court, the
 * serve, the walls, the scoring, tips for a first game, and the questions new players ask most. The drawings and
 * the facts are shared with the TV slides (intro.js, where the sources are listed). */
(function () {
  'use strict';
  var S = window.Store, I = window.Intro;
  function h(tag, cls, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    var add = function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    };
    add(kids);
    return el;
  }
  function art(markup) { var d = h('div', 'le-art'); d.innerHTML = markup; return d; }
  function sec(id, kicker, title, kids) { var s = h('section', 'le-sec', [h('div', 'le-kick', kicker), h('h2', null, title), kids]); s.id = id; return s; }
  function list(items, ordered) { return h(ordered ? 'ol' : 'ul', 'le-list', items.map(function (t) { return h('li', null, Array.isArray(t) ? [h('b', null, t[0]), ' ', t[1]] : t); })); }
  function p(text) { return h('p', null, text); }

  var FAQ = [
    ['How do you say it?', 'In Spanish, where the sport grew up, it is “PAH-del”. In the US you will also hear “paddle” and “pa-DELL”. Any of them will get you a game.'],
    ['Is padel the same as pickleball?', 'No. Padel is played on an enclosed court where the glass walls are part of the game, with a solid racket (no strings) and a ball like a tennis ball, and it is scored like tennis. Pickleball uses a smaller open court, a plastic ball with holes, no walls and its own scoring.'],
    ['How is it different from tennis?', 'The court is about a third of the size, the walls are in play, the serve is underhand, the racket is solid and the game is always doubles. Rallies are longer, and placing the ball matters more than hitting it hard.'],
    ['Do I need to have played tennis or another racket sport?', 'No. It helps for the first ten minutes, and then everyone has to learn the walls. Plenty of good padel players never played tennis.'],
    ['Is it hard to learn?', 'It is one of the easiest racket sports to start. The serve is underhand, the court is small and the walls keep the ball in play, so most people are rallying in their first session. Learning to use the glass well takes longer, and that is the fun of it.'],
    ['Do I need a partner?', 'Padel is doubles, but you can come on your own. At our socials partners and opponents change through the session, so you will meet people and never be left without a game.'],
    ['What should I wear and bring?', 'Sports clothes, water, and court shoes: tennis or padel shoes grip best on the sandy turf. Running shoes will do for a first try, but they are not made for moving sideways. If you do not have a racket, ask at the front desk.'],
    ['Why is the serve underhand?', 'It is the rule: you let the ball bounce and hit it at or below your waist. It means the serve starts the rally instead of ending it, which is a big part of why beginners can play real points right away.'],
    ['Can the ball hit the walls?', 'Yes, after it has bounced on the floor. If a ball lands on your side and then hits the glass or the fence, it is still in play: hit it before it bounces again. A ball that reaches the other team’s wall or fence before touching their floor is out.'],
    ['Can I hit the ball against my own glass?', 'Yes. When the ball is behind you, you can hit it into the glass on your own side so that it travels back over the net. It has to be the glass, not the wire fence.'],
    ['Can I volley? Is there a “kitchen”?', 'You can hit the ball out of the air anywhere on the court, and getting to the net is how points are won. The one exception is the return of serve, which has to bounce first. There is no kitchen in padel.'],
    ['How does the scoring work?', 'Like tennis: 15, 30, 40, game. Six games win a set (by two, with a tie-break at 6–6), and a match is the best of three sets. At our socials we usually play short sets so that everyone changes court often.'],
    ['What is the golden point?', 'At 40–40, instead of playing advantage, one point decides the game, and the receiving pair chooses which of them takes the serve. Since 2026 the professional tours use the “star point”: up to two advantages, and then one deciding point.'],
    ['How long does a match take?', 'A full match, best of three sets, usually takes an hour to an hour and a half. Rounds at a social are much shorter.'],
    ['Can you play singles?', 'The game is doubles. A few clubs have narrower singles courts, but almost everything you will see and play is two against two.'],
    ['What happens if the ball hits me?', 'You lose the point, wherever you are standing. The same goes for your partner, and for touching the net.'],
    ['Do players really run out of the court to hit the ball?', 'Yes. On courts with open doors, a ball that bounces and flies out over the wall can be chased down and played back before it bounces again. You will see it in professional matches. Nobody expects it in your first game.'],
    ['Is it good exercise? Is it hard on the body?', 'An hour of padel is a solid workout: lots of short sprints, turns and reaches. It is generally gentler than tennis because the court is small and the serve is underhand. Warm up your shoulders and legs, and hold the racket loosely.'],
    ['Is padel in the Olympics?', 'Not yet. The international federation is working towards it. For now the big stages are the professional Premier Padel tour and the world championships.'],
    ['How many people play?', 'More than 40 million people in over 190 countries, on more than 91,000 courts. In the United States over a million people played in 2025, and in 2026 padel was the fastest-growing sport in the national participation report.']
  ];

  function build() {
    var logo = h('img'), word = h('img', 'w');
    logo.src = S.asset('logo-p.png'); logo.alt = ''; word.src = S.asset('conquer-wordmark-white.png'); word.alt = 'Conquer Padel Club';
    var chips = [['190+', 'countries'], ['40M+', 'players'], ['#1', 'fastest-growing sport in the US']].map(function (c) { return h('div', 'le-chip', [h('b', null, c[0]), h('span', null, c[1])]); });
    var nav = [['court', 'The court'], ['serve', 'The serve'], ['walls', 'The walls'], ['score', 'Scoring'], ['tips', 'First-game tips'], ['faq', 'Questions']].map(function (n) { var a = h('a', null, n[1]); a.href = '#' + n[0]; return a; });
    var faq = FAQ.map(function (q, i) { var d = h('details', 'le-q', [h('summary', null, q[0]), h('p', null, q[1])]); if (i === 0) d.open = true; return d; });
    return [
      h('header', 'le-top', [logo, word]),
      h('div', 'le-hero', [h('div', 'le-kick', 'New to padel?'), h('h1', null, 'Start here'),
        p('Padel is a mix of tennis and squash, played in doubles on a small court with glass walls. It is easy to start and hard to stop.'),
        h('div', 'le-chips', chips)]),
      h('nav', 'le-nav', nav),
      sec('court', 'The basics', 'The court', [art(I.art.court('')), h('div', 'le-legend', [h('span', 'g', 'Glass'), h('span', 'm', 'Fence'), h('span', 'n', 'Net')]), list([
        ['66 × 33 feet,', 'about a third of a tennis court.'],
        ['Walls all around:', 'glass at the ends and corners, wire fence along the sides.'],
        ['Always doubles.', 'Two against two, so everyone is in every point.'],
        ['The racket is solid,', 'with holes and no strings. The strap goes around your wrist, always.']])]),
      sec('serve', 'The basics', 'The serve', [art(I.art.serve()), list([
        ['Underhand.', 'Let the ball bounce, then hit it at or below your waist.'],
        ['Diagonal.', 'Stand behind the service line and send it into the box across from you.'],
        ['Two tries.', 'Miss the first serve and you get a second one.'],
        ['Glass is fine.', 'After it bounces in the box the ball may touch the glass, but not the fence.']], true)]),
      sec('walls', 'The basics', 'The walls are your friends', [
        h('div', 'le-card ok', [art(I.art.wallGood()), h('b', null, '✓ Floor first, then the wall: play on'), p('The ball bounces on your side and comes off the glass. Take your time and hit it back before it bounces again.')]),
        h('div', 'le-card no', [art(I.art.wallBad()), h('b', null, '✗ Wall first: out'), p('Your shot has to land on their floor before it touches their glass or fence.')]),
        p('You can also hit the ball into your own glass to send it back over the net.')]),
      sec('score', 'The basics', 'Keeping score', [h('div', 'le-score', ['15', '30', '40', 'Game'].map(function (t, i) { return h('b', i === 3 ? 'g' : null, t); })), list([
        ['Like tennis.', 'Six games win a set, and a match is the best of three sets.'],
        ['Golden point.', 'At 40–40, one point decides the game. The receivers choose which side takes the serve.'],
        ['At our socials', 'we play short sets, you change opponents every round, and every game you win is a point on the leaderboard.']]),
        h('h3', null, 'You lose the point when…'), list(['the ball bounces twice on your side', 'you hit it into the net, or out', 'it hits their wall or fence before their floor', 'the ball touches you or your partner', 'you touch the net'])]),
      sec('tips', 'Your first game', 'Five tips to start well', list([
        ['Let it come off the glass.', 'There is more time than you think. Turn, wait, and hit it after the wall.'],
        ['Soft beats hard.', 'Hard shots bounce back to your opponents. A high lob is your best friend.'],
        ['Take the net together.', 'Points are won up front. Move forward as a pair, and back as a pair.'],
        ['Talk to your partner.', '“Mine!”, “Yours!”, “Out!” It is a team game.'],
        ['Have fun.', 'Everyone was a beginner once. ¡Vamos!']], true)),
      sec('faq', 'Good to know', 'Questions new players ask', h('div', 'le-faq', faq)),
      sec('story', 'Where it comes from', 'Born in Mexico, raised in Spain', p('The first court was built in 1969 in Acapulco, Mexico, by Enrique Corcuera, at his home. A friend took the idea to Marbella, Spain, in 1974, and from there it spread through Europe and Latin America. Today it is played in more than 190 countries.')),
      h('footer', 'le-foot', [p('Questions? Ask anyone on the Conquer team. See you on court.'),
        h('small', null, 'Figures: International Padel Federation, World Padel Report 2026; SFIA 2026 participation report; US Padel Association. Rules: FIP Regulations of the Padel Game.')])
    ];
  }
  document.getElementById('app').replaceChildren.apply(document.getElementById('app'), build());
})();
