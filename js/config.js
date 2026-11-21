'use strict';

/* Réglages du jeu. Tout ce qui se règle "à la main" est ici.
   Les distances sont en unités d'arène : une unité = un carreau du quadrillage. */

const CONFIG = Object.freeze({
  /* Partie en ligne. `server` : serveur de mise en relation PeerJS ; null =
     le service gratuit de PeerJS. `stunServers` : pour trouver un chemin
     direct entre appareils. `relayCredentialsUrl` : adresse qui fournit les
     identifiants d'un relais (TURN), utilisé quand le chemin direct est
     bloqué (partage de connexion, 4G…) ; null = pas de relais.
     `relayServers` : ou bien les serveurs de relais eux-mêmes, identifiants
     compris (ici le compte Metered du projet : 500 Mo par mois gratuits,
     coupé au-delà jusqu'au mois suivant). Le relais public de PeerJS ne
     répond plus : on ne s'en sert pas. `sendInterval` : secondes entre deux
     messages de l'hôte ; `smoothing` et `extrapolateMax` : lissage des
     têtes chez les invités. */
  online: Object.freeze({
    server: null,
    stunServers: Object.freeze(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']),
    relayCredentialsUrl: null,
    relayServers: Object.freeze([
      'turn:global.relay.metered.ca:80',
      'turn:global.relay.metered.ca:80?transport=tcp',
      'turn:global.relay.metered.ca:443',
      'turns:global.relay.metered.ca:443?transport=tcp',
    ].map((urls) => Object.freeze({ urls, username: 'db19eadfbab9535ccc440c96', credential: 'r9ajEtHo9Vxe+Q1p' }))),
    idPrefix: 'debattle-',
    codeLetters: 'ABCDEFGHJKMNPQRSTUVWXYZ',
    codeLength: 4,
    maxHumans: 6,
    maxPerTeam: 3,
    sendInterval: 0.05,
    smoothing: 14,
    extrapolateMax: 0.2,
    connectTimeout: 20,
    /* Présence : chaque appareil signale qu'il est là toutes les
       `pingInterval` secondes ; sans nouvelles depuis `silenceTimeout`
       secondes, l'autre est considéré comme parti. */
    pingInterval: 1,
    silenceTimeout: 15,
  }),
  /* Arène de chaque mode : sa forme (voir maps.js) et le côté du carré où
     elle s'inscrit, en unités. La France des équipes couvre trois fois la
     surface de celle des versions précédentes (qui tenait dans 60 unités). */
  arenas: Object.freeze({
    team: Object.freeze({ shape: 'france', size: 101 }),
    demo: Object.freeze({ shape: 'round', size: 84 }),   // derrière l'accueil
  }),
  /* Cartes au choix des parties en ligne : forme et taille, en duel (1v1)
     et en équipes. Avec les règles « Zones », `zones` donne le découpage
     (la France garde ses régions) ; en « Normal », pas de découpage. */
  maps: Object.freeze({
    round: Object.freeze({ label: 'Disque', shape: 'round', duel: 56, teams: 84, zones: 'quartier' }),
    square: Object.freeze({ label: 'Carré', shape: 'square', duel: 50, teams: 76, zones: 'quartier' }),
    ring: Object.freeze({ label: 'Anneau', shape: 'ring', duel: 62, teams: 90, zones: 'quartier' }),
    archipel: Object.freeze({ label: 'Archipel', shape: 'archipel', duel: 66, teams: 96, zones: 'quartier' }),
    france: Object.freeze({ label: 'France', shape: 'france', duel: 84, teams: 101, zones: 'region' }),
  }),
  /* Statistiques : un assist revient à chaque adversaire (autre que
     l'auteur de l'élimination) qui, dans les `assistWindow` dernières
     secondes, a pris du territoire au camp de la victime ou l'a serrée de
     près (à moins de `pressureRadius` unités de sa tête ou de sa traînée,
     pendant qu'elle était hors de chez elle). Les taux par seconde sont
     des moyennes glissantes sur `rateWindow` secondes, relevées toutes les
     `sampleEvery` secondes. */
  stats: Object.freeze({ assistWindow: 8, pressureRadius: 4, pressureEvery: 0.2, rateWindow: 10, sampleEvery: 1 }),
  /* Brouillard en équipes : on voit à `headRadius` unités d'un allié, à
     `landRadius` unités du territoire de son camp, et toute une région
     tenue par son camp (sa « tour de vision »). Recalculé toutes les
     `refresh` secondes. Radar : une onde qui révèle tout à `radius`
     unités du lanceur, pendant `duration` s, rechargée en `cooldown` s.
     Éclaireur : un drone lancé droit devant à `speed` unités par seconde
     pendant `flight` s, qui révèle `radius` unités autour de lui pendant
     `duration` s. */
  vision: Object.freeze({
    headRadius: 11, landRadius: 3, refresh: 0.2,
    radar: Object.freeze({ radius: 30, sweep: 0.9, duration: 3.5, cooldown: 20 }),
    scout: Object.freeze({ radius: 8, speed: 15, flight: 1.6, duration: 7, cooldown: 14 }),
  }),
  qualifyShare: 1 / 3,     // en équipes : part d'arène minimale pour passer au second tour
  resolution: 4,           // finesse du territoire : 4 x 4 cases par unité
  startRadius: 2.5,        // rayon du territoire initial, en solo
  teamSize: 3,             // joueurs par équipe au départ, en mode Équipes
  teamMaxSize: 9,          // taille maximale d'une équipe, renforts compris
  recruitChancePerShare: 10,   // chance de renfort : part d'arène gagnée x 10 (10 % gagnés = renfort assuré)
  teamBaseRadius: 4,       // rayon du territoire initial d'une équipe
  speed: 8.8,              // unités parcourues par seconde, avec un petit territoire
  slowdownPerShare: 1,     // ralentissement : 1 % de vitesse en moins par % d'arène possédé...
  maxSlowdown: 0.4,        // ...jusqu'à 40 % de vitesse en moins
  maxStepDistance: 0.4,    // distance maximale parcourue en un pas de calcul
  turnRate: 7,             // vitesse de virage, en radians par seconde : des virages secs, nerveux
  trailRadius: 0.5,        // demi-largeur de la traînée, pour les collisions
  headRadius: 0.4,         // demi-taille de la tête, pour le bord et les chocs
  selfHitGap: 2.5,         // longueur de traînée récente que la tête ne peut pas heurter
  botCount: 5,             // adversaires de la démonstration, derrière l'accueil
  botRespawnDelay: 3,      // secondes avant le retour d'un adversaire éliminé (et du joueur, en Normal)
  spawnClearanceShare: 0.27,   // distance minimale visée entre deux apparitions, en fraction du côté de l'arène
  playerDeathDelay: 0.9,   // secondes entre l'élimination et l'écran de défaite
  regionShare: 0.7,        // au-delà de 70 % d'une région, un camp la complète d'un coup
  winShare: 0.51,          // le premier camp à posséder 51 % de l'arène gagne
  maxFrameTime: 0.05,      // pas de simulation maximal, en secondes
  abilities: Object.freeze({
    maxCharges: 10,
    boost: Object.freeze({ cost: 1, duration: 2.5, speedFactor: 1.6 }),
    /* Dash : vitesse × (baseSpeedFactor + speedPerKill × éliminations) pendant
       baseDuration + durationPerKill × éliminations secondes, éliminations
       comptées jusqu'à maxKills. De 11 unités environ à 3 éliminations à 22 à 10. */
    dash: Object.freeze({ cost: 3, baseSpeedFactor: 3, speedPerKill: 0.25, baseDuration: 0.3, durationPerKill: 0.02, maxKills: 10 }),
    bomb: Object.freeze({ cost: 10, range: 9, flightTime: 0.55, coreRadius: 3.2, lobes: 9, drops: 7 }),
  }),
  touch: Object.freeze({
    deadZone: 10,            // pixels de glissé avant qu'un virage parte
    leash: 24,               // longueur de la « laisse » du point d'appui, en pixels
    tiltPerPixel: 0.006,     // inclinaison de la caméra, en radians par pixel
    twistThreshold: 0.2,     // rotation des doigts avant que la caméra se mette à pivoter, en radians
    rotatePerPixel: 0.006,   // pivot de la caméra au clic droit, en radians par pixel
  }),
  view: Object.freeze({ cellsAcross: 15, minCell: 20, maxCell: 40 }),
});

/* Palette, reprise de « L'Avenir en commun » : violets, rouge, crème,
   charbon, jaune, vert, bleu, rose. Les couleurs du décor (ciel, plateau,
   brume) changent avec le thème Jour / Nuit : voir theme.js. Chaque
   couleur de camp a une face (main), une tranche (dark) et un reflet (light). */
const AEC = Object.freeze({
  violet: '#4C0297', violet2: '#7b13d6', violetD: '#2c0159',
  rouge: '#D1271C', rouge2: '#f91616', rougeF: '#8f1a12',
  creme: '#FFFCF4', charbon: '#212320', jaune: '#f9c900', vert: '#2e9959', bleu: '#3885f4', rose: '#ed5fb1',
});
const PALETTE = Object.freeze({
  ink: AEC.charbon,
  ground: AEC.creme,          // clair de référence, pour détourer les textes
  flash: '#ffffff',
  player: Object.freeze({ main: AEC.jaune, dark: '#b88f00', light: '#ffe066', text: AEC.charbon }),
  bots: Object.freeze([
    Object.freeze({ main: AEC.bleu, dark: '#1f5cb8', light: '#79acfa', text: '#ffffff' }),
    Object.freeze({ main: AEC.rose, dark: '#b33a82', light: '#f594cc', text: AEC.charbon }),
    Object.freeze({ main: AEC.vert, dark: '#1d6b3d', light: '#5fc188', text: '#ffffff' }),
    Object.freeze({ main: AEC.violet2, dark: AEC.violetD, light: '#a456ea', text: '#ffffff' }),
    Object.freeze({ main: AEC.rouge, dark: AEC.rougeF, light: '#ec5a50', text: '#ffffff' }),
    Object.freeze({ main: '#f2802a', dark: '#b85712', light: '#f7a865', text: AEC.charbon }),
    Object.freeze({ main: '#17ada3', dark: '#0d7a73', light: '#57d0c8', text: AEC.charbon }),
  ]),
});
/* Couleurs au choix du joueur en solo ; les adversaires prennent les autres. */
const SOLO_COLORS = Object.freeze([PALETTE.player, ...PALETTE.bots]);


const PLAYER_NAME = 'Toi';

/* Duel en ligne : la couleur de l'hôte, puis celle de son adversaire. */
const DUEL_COLORS = Object.freeze([PALETTE.player, PALETTE.bots[0]]);

/* Campagne « Crée ton parti » : cinq niveaux, chacun une mêlée générale où
   il faut posséder 51 % de l'arène. Les candidats deviennent des partis à
   partir de `partyFromLevel` (la ville). */
const CAMPAIGN = Object.freeze({
  partyFromLevel: 1,
  maxRivals: 7,
  /* Difficultés de la campagne :
     - respawn : éliminé, on réapparaît dans la même partie, qui continue
       jusqu'à ce qu'un camp atteigne 51 % ;
     - final : perdre en étant dans les deux premiers avec au moins un tiers
       de l'arène lance une finale contre l'autre camp du duo de tête ;
     - restart : après une défaite, 'level' = on reprend le niveau,
       'start' = on reprend tout au quartier ;
     - extraRivals : adversaires en plus à chaque niveau. */
  difficulties: Object.freeze({
    normal: Object.freeze({ label: 'Normal', respawn: true, final: true, restart: 'level', extraRivals: 0 }),
    chaud: Object.freeze({ label: 'Chaud', respawn: false, final: true, restart: 'level', extraRivals: 0 }),
    hardcore: Object.freeze({ label: 'Hardcore', respawn: false, final: false, restart: 'start', extraRivals: 2 }),
  }),
  levels: Object.freeze([
    Object.freeze({ name: 'Quartier', goal: 'ton quartier', arena: Object.freeze({ shape: 'round', size: 42, zones: 'secteur' }), rivals: 3 }),
    Object.freeze({ name: 'Ville', goal: 'ta ville', arena: Object.freeze({ shape: 'round', size: 56, zones: 'quartier' }), rivals: 4 }),
    Object.freeze({ name: 'Département', goal: 'ton département', arena: Object.freeze({ shape: 'round', size: 70, zones: 'commune' }), rivals: 5 }),
    Object.freeze({ name: 'Région', goal: 'ta région', arena: Object.freeze({ shape: 'round', size: 84, zones: 'departement' }), rivals: 5 }),
    Object.freeze({ name: 'Élection finale', goal: 'le pays', arena: Object.freeze({ shape: 'france', size: 116 }), rivals: 5 }),
  ]),
});

/* Découpage des arènes en zones : un camp qui possède plus de
   CONFIG.regionShare d'une zone reçoit le reste. `count` : nombre de zones
   d'une arène ronde ; `names` : noms tirés au sort (inventés) ; `done` :
   l'annonce faite au joueur ; `short` : abréviation du classement. La
   carte de France a ses vraies régions. */
const ZONE_KINDS = Object.freeze({
  secteur: Object.freeze({
    one: 'secteur', many: 'secteurs', short: 'sect.', done: 'Secteur conquis', count: 5,
    names: Object.freeze(['Place du Marché', 'Rue des Lilas', 'Cité des Pins', 'Le Lavoir', 'Square de la Pétanque',
      'Allée des Tilleuls', 'Résidence Les Mimosas', 'Impasse du Bureau de Vote']),
  }),
  quartier: Object.freeze({
    one: 'quartier', many: 'quartiers', short: 'quart.', done: 'Quartier conquis', count: 6,
    names: Object.freeze(['Centre-Ville', 'La Gare', 'Les Glycines', 'Le Vieux Port', 'La Butte', 'Zone Commerciale',
      'Le Faubourg', 'Les Hauts-de-Pétanque']),
  }),
  commune: Object.freeze({
    one: 'commune', many: 'communes', short: 'comm.', done: 'Commune conquise', count: 7,
    names: Object.freeze(['Saint-Bulletin', 'Pognon-sur-Mer', 'Villeneuve-la-Sieste', 'Mégaphone-les-Bains', 'Bourg-Promesse',
      'Sainte-Urne', 'Tracteur-le-Haut', 'Isoloir-en-Plaine', 'Rond-Point-sur-Rivière']),
  }),
  departement: Object.freeze({
    one: 'département', many: 'départements', short: 'dép.', done: 'Département conquis', count: 9,
    names: Object.freeze(['Hauts-Bulletins', 'Basse-Promesse', 'Urne-et-Isoloir', 'Côtes-du-Tract', 'Val-de-Sieste',
      'Haute-Pétanque', 'Mégaphone-Maritime', 'Pognon-Atlantique', 'Seine-et-Slogan', 'Monts-du-Meeting']),
  }),
  region: Object.freeze({ one: 'région', many: 'régions', short: 'rég.', done: 'Région complétée' }),
});

/* Noms des joueurs IA en mode Équipes : des rôles, les mêmes pour les trois
   camps. Volontairement pas de noms de personnes réelles. */
const TEAM_ROLE_NAMES = Object.freeze([
  'Militant', 'Bénévole', 'Colleuse', 'Candidate', 'Député', 'Sénatrice', 'Maire', 'Déléguée', 'Trésorier',
]);

/* Mode Équipes : trois camps aux règles strictement identiques, listés par
   ordre alphabétique. Seuls le nom et la couleur changent.
   Couleurs d'usage de chaque parti, adaptées en aplats pour rester lisibles :
   - LFI : son dégradé rouge ocre / violet devient face rouge et tranche violette ;
   - Renaissance : le jaune qui la représente d'ordinaire sur les cartes et
     graphiques, car son bleu marine se confondrait avec celui du RN ;
   - RN : bleu marine. */
const TEAMS = Object.freeze([
  Object.freeze({
    key: 'lfi', name: 'LFI',
    colors: Object.freeze({ main: AEC.rouge, dark: AEC.violet, light: '#ec5a50', text: '#ffffff' }),
  }),
  Object.freeze({
    key: 'renaissance', name: 'Renaissance',
    colors: Object.freeze({ main: AEC.jaune, dark: '#b88f00', light: '#ffe066', text: AEC.charbon }),
  }),
  Object.freeze({
    key: 'rn', name: 'RN',
    colors: Object.freeze({ main: '#1a2f7a', dark: '#0a1540', light: '#4862b8', text: '#ffffff' }),
  }),
]);

/* Écart entre deux angles, ramené entre -PI et PI. */
function angleDifference(from, to) {
  const difference = (to - from) % (Math.PI * 2);
  if (difference > Math.PI) return difference - Math.PI * 2;
  if (difference < -Math.PI) return difference + Math.PI * 2;
  return difference;
}
