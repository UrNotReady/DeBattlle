'use strict';

/* Point d'entrée : relie les règles, le rendu, les contrôles et l'interface,
   et mène la campagne « Crée ton parti » d'un niveau à l'autre. */

(function start() {
  const STORAGE = Object.freeze({
    // Clés d'origine (« Politique Papers ») gardées : les sauvegardes restent.
    campaign: 'politique-papers.campagne',
    difficulty: 'politique-papers.difficulte',
    settings: 'politique-papers.options',
    nickname: 'politique-papers.pseudo',
    record: 'politique-papers.record.',   // + 'equipes' ou 'niveau-1' … 'niveau-5'
  });
  const canvas = document.getElementById('arena');
  const renderer = createRenderer(canvas);
  const minimap = createMinimap(document.getElementById('minimap'));
  const speech = createSpeech();
  const ABILITY_ACTIONS = { boost: useBoost, bomb: useBomb };   // le dash se vise : voir startAim
  /* Options du joueur : contrôle 'auto' (le cube avance toujours) ou
     'manual' (il n'avance que si on le dirige) ; traînée 'vulnerable' ou
     'safe' (personne ne peut la couper). */
  const DEFAULT_SETTINGS = Object.freeze({ control: 'auto', trail: 'vulnerable' });
  const ui = createUI({
    onCampaign: openCampaign,
    onTeam: (teamKey) => startTeamGame({ teamKey, round: 1, opponentKey: null }),
    onAbilityEnd: endAbility,
    onAim: aimDash,
    settings: { open: openSettings, change: changeSetting, close: closeSettings },
    online: {
      host: openHosting,
      join: openJoin,
      joinSubmit: joinGame,
      back: leaveOnline,
      share: shareRoom,
      rename: renameOnline,
      pickTeam: pickOnlineTeam,
      start: startOnlineMatch,
      leave: leaveOnline,
    },
    onDifficulty: (chosen) => {
      difficulty = chosen;
      writeStorage(STORAGE.difficulty, chosen);
    },
    onPrimary: () => primaryAction(),
    onMenu: () => (online ? leaveOnline() : showMenu()),
    onAbility: useAbility,
    onResetCamera: renderer.resetYaw,
    pause: {
      open: pauseGame,
      resume: resumeGame,
      rename: renamePlayer,
      color: recolorPlayer,
      difficulty: (chosen) => {
        if (chosen === difficulty) return;
        difficulty = chosen;
        writeStorage(STORAGE.difficulty, chosen);
        playLevel();   // le niveau recommence dans la nouvelle difficulté
      },
      team: (teamKey) => startTeamGame({ teamKey, round: 1, opponentKey: null }),
      campaign: () => openCampaign(false),
    },
  });

  let game = null;
  let screen = 'home';          // 'home' | 'pick' | 'playing' | 'paused' | 'over'
  let paused = false;           // partie figée (pause, et choix d'un nom pendant la pause)
  let settings = loadSettings();
  let settingsReturn = 'home';  // écran d'où l'on a ouvert les options : 'home' ou 'paused'
  let aim = null;               // visée du dash en cours : { angle } (cap dans l'arène), ou null
  let heldHeading = null;       // dernière direction donnée (à l'écran), null si aucune
  let wasDashing = false;
  let badge = '';               // badge de la partie en cours (niveau ou tour)
  let campaign = loadCampaign();   // { level, identity } ou null
  let difficulty = loadDifficulty();   // 'normal', 'chaud' ou 'hardcore'
  let teamSettings = null;      // réglages de la partie en équipes en cours
  let primaryAction = () => {}; // ce que fait le bouton principal de l'écran de fin
  let lastTime = performance.now();
  /* Partie en ligne en cours (salon compris), ou null :
     { role: 'host' | 'guest', code, me, lobby, net, sync, clock, status, tone, lastSteer }. */
  let online = null;

  /* --- Sauvegarde (dans ce navigateur seulement) ---------------------- */

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;   // stockage indisponible : rien n'est gardé d'une visite à l'autre
    }
  }

  function writeStorage(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) { /* voir readStorage */ }
  }

  function loadCampaign() {
    try {
      const saved = JSON.parse(readStorage(STORAGE.campaign));
      const valid = saved && Number.isInteger(saved.level) && saved.level >= 0 && saved.level < CAMPAIGN.levels.length &&
        saved.identity && saved.identity.candidate && Array.isArray(saved.identity.rivals);
      return valid ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function loadDifficulty() {
    const saved = readStorage(STORAGE.difficulty);
    return CAMPAIGN.difficulties[saved] ? saved : 'normal';
  }

  function saveCampaign() {
    writeStorage(STORAGE.campaign, campaign ? JSON.stringify(campaign) : null);
  }

  /* Records : la meilleure part d'arène, par niveau de campagne ou en équipes. */
  const recordKey = (activeGame) => STORAGE.record + (activeGame.mode === 'team' ? 'equipes' : `niveau-${activeGame.level + 1}`);
  const loadRecord = (activeGame) => Number(readStorage(recordKey(activeGame))) || 0;

  /* --- Écrans --------------------------------------------------------- */

  /* Derrière l'accueil, les adversaires jouent seuls. */
  function showMenu() {
    game = createGame({ mode: 'demo' });
    paused = false;
    aim = null;
    renderer.reset(game);
    speech.reset();
    showHomeScreen();
  }

  function showHomeScreen() {
    screen = 'home';
    ui.showHome(campaign ? { level: campaign.level, name: campaignName() } : null, difficulty);
  }

  function campaignName() {
    return campaign.identity.party || campaign.identity.candidate.full;
  }

  function startGame(options, gameBadge, announcement) {
    game = createGame({ ...options, safeTrail: settings.trail === 'safe' });
    screen = 'playing';
    paused = false;
    aim = null;
    wasDashing = false;
    badge = gameBadge;
    renderer.reset(game);
    speech.reset();
    minimap.refreshNow();
    ui.showPlaying(game, gameBadge);
    if (announcement) ui.announce(announcement);
    canvas.focus({ preventScroll: true });
  }

  /* --- Campagne « Crée ton parti » ------------------------------------ */

  /* Reprend la campagne en cours, ou en commence une (choix du candidat). */
  function openCampaign(fresh) {
    if (campaign && !fresh) {
      playLevel();
      return;
    }
    pickCandidate();
  }

  /* Un nom complet, proposé ou écrit par le joueur ; un nom d'un seul mot
     sert aussi de nom de famille (pour les noms de partis qui en dérivent). */
  function candidateFromName(fullName) {
    const [first, ...rest] = fullName.split(' ');
    return { first, last: rest.join(' ') || first, full: fullName };
  }

  function pickCandidate() {
    screen = 'pick';
    ui.showPicker({
      title: 'Choisis ton candidat',
      text: 'Un nom, une carrure, un destin. Les autres candidats ont déjà imprimé leurs tracts.',
      options: generateCandidates(3).map((candidate) => candidate.full),
      onPick: (fullName) => {
        const candidate = candidateFromName(fullName);
        campaign = { level: 0, identity: { candidate, party: null, rivals: generateRivals(5, Math.random, [candidate]) } };
        saveCampaign();
        playLevel();
      },
      onReroll: pickCandidate,
      onBack: showMenu,
    });
  }

  /* Arrivé en ville, le candidat fonde son parti. */
  function pickParty() {
    screen = 'pick';
    const { candidate } = campaign.identity;
    ui.showPicker({
      title: 'Fonde ton parti',
      text: `Bienvenue en ville, ${candidate.full} ! Ton mouvement a besoin d'un nom. Les adversaires, eux, ont déjà choisi le leur.`,
      options: generatePartyNames(candidate),
      onPick: (party) => {
        campaign.identity.party = party;
        saveCampaign();
        playLevel();
      },
      onReroll: pickParty,
      onBack: showMenu,
    });
  }

  /* Joue le niveau en cours ; `opponentKey` donné : sa finale. */
  function playLevel(opponentKey = null) {
    const { level, identity } = campaign;
    if (level >= CAMPAIGN.partyFromLevel && !identity.party) {
      pickParty();
      return;
    }
    const info = CAMPAIGN.levels[level];
    const label = CAMPAIGN.difficulties[difficulty].label;
    const round = opponentKey ? 2 : 1;
    startGame(
      { mode: 'solo', level, identity, difficulty, round, opponentKey },
      round === 2 ? `Finale · ${info.name} · ${label}` : `${level + 1}/${CAMPAIGN.levels.length} · ${info.name} · ${label}`,
      round === 2 ? 'Finale : 51 % pour départager !' : `${info.name} : remporte 51 % de ${info.goal} !`,
    );
    saveCampaign();   // l'identité a pu recevoir de nouveaux adversaires (Hardcore)
  }

  /* Gagné : on passe au niveau suivant (la campagne s'achève après
     l'élection finale). Qualifié : finale du niveau. Perdu : on reprend le
     même niveau, ou tout depuis le quartier en Hardcore. */
  function settleCampaign() {
    const { won, qualified, opponent } = game.ending;
    if (qualified) {
      primaryAction = () => playLevel(opponent.key);
      return;
    }
    if (!won) {
      if (CAMPAIGN.difficulties[game.difficulty].restart === 'start') {
        campaign.level = 0;
        saveCampaign();
      }
      primaryAction = () => playLevel();
      return;
    }
    if (game.level === CAMPAIGN.levels.length - 1) {
      campaign = null;
      saveCampaign();
      primaryAction = () => openCampaign(true);
      return;
    }
    campaign.level = game.level + 1;
    saveCampaign();
    primaryAction = () => playLevel();
  }

  /* --- Pause ---------------------------------------------------------- */

  function pauseGame() {
    if (screen !== 'playing' || game.over) return;
    paused = game.mode !== 'online';   // en ligne, la partie continue pour les autres
    screen = 'paused';
    showPauseScreen();
  }

  function showPauseScreen() {
    screen = 'paused';
    ui.showPause({
      mode: game.mode,
      where: badge,
      name: game.mode === 'solo' ? campaignName() : '',
      colorIndex: game.mode === 'solo' ? campaign.identity.colorIndex || 0 : 0,
      difficulty: game.difficulty,
      teamKey: teamSettings && teamSettings.teamKey,
      hasCampaign: Boolean(campaign),
    });
  }

  function resumeGame() {
    paused = false;
    screen = 'playing';
    // Contrôle manuel : touches ou doigt relâchés pendant la pause, le cube reste arrêté.
    if (settings.control === 'manual' && heldHeading === null) command({ type: 'steer', angle: null });
    ui.resumePlaying(game);
    canvas.focus({ preventScroll: true });
  }

  /* Échap ou P : met en pause, ou reprend. */
  function togglePause() {
    if (screen === 'playing') pauseGame();
    else if (screen === 'paused') resumeGame();
    else return false;
    return true;
  }

  /* En campagne, le nom affiché change aussitôt : celui du candidat tant
     qu'il n'a pas de parti, celui du parti ensuite. */
  function renamePlayer() {
    const { identity } = campaign;
    const land = game.lands[game.player.landId - 1];
    const apply = (name) => {
      land.name = name;
      saveCampaign();
      showPauseScreen();
    };
    screen = 'pick';
    if (identity.party) {
      ui.showPicker({
        title: 'Renomme ton parti',
        text: 'Même programme, nouvelle affiche. Les militants suivront.',
        options: generatePartyNames(identity.candidate),
        onPick: (party) => {
          identity.party = party;
          apply(party);
        },
        onReroll: renamePlayer,
        onBack: showPauseScreen,
      });
      return;
    }
    ui.showPicker({
      title: 'Change de nom',
      text: 'Nouveau nom, mêmes promesses. Personne ne remarquera rien.',
      options: generateCandidates(3, Math.random, [identity.candidate, ...identity.rivals]).map((candidate) => candidate.full),
      onPick: (fullName) => {
        identity.candidate = candidateFromName(fullName);
        apply(fullName);
      },
      onReroll: renamePlayer,
      onBack: showPauseScreen,
    });
  }

  /* La couleur change aussitôt dans la partie, et pour la suite de la campagne. */
  function recolorPlayer(colorIndex) {
    campaign.identity.colorIndex = colorIndex;
    recolorSoloGame(game, campaign.identity);
    saveCampaign();
    minimap.refreshNow();
    showPauseScreen();
  }

  /* --- Équipes -------------------------------------------------------- */

  function startTeamGame(settings) {
    teamSettings = settings;
    const roundBadge = settings.round === 2 ? 'Second tour' : 'Premier tour';
    let announcement = 'Premier tour : 51 % et c\'est plié !';
    if (settings.round === 2) {
      const mine = TEAMS.find((team) => team.key === settings.teamKey).name;
      const theirs = TEAMS.find((team) => team.key === settings.opponentKey).name;
      announcement = `Second tour : ${mine} contre ${theirs}`;
    }
    startGame({ mode: 'team', ...settings }, roundBadge, announcement);
  }

  /* Qualifié : le bouton principal lance le second tour. Sinon, un nouveau premier tour. */
  function settleTeamGame() {
    const { qualified, opponent } = game.ending;
    const next = qualified
      ? { ...teamSettings, round: 2, opponentKey: opponent.key }
      : { ...teamSettings, round: 1, opponentKey: null };
    primaryAction = () => startTeamGame(next);
  }

  /* --- Fin de partie -------------------------------------------------- */

  function endGame() {
    screen = 'over';
    if (game.mode === 'online') {
      endOnlineGame();
      return;
    }
    const share = game.ending.cells / game.grid.playableCount;
    const best = loadRecord(game);
    const isNewRecord = !game.unranked && share > best && game.ending.cells > game.startCells;
    if (isNewRecord) writeStorage(recordKey(game), String(share));
    if (game.mode === 'team') settleTeamGame();
    else settleCampaign();
    ui.showGameOver(game, Math.max(best, isNewRecord ? share : 0), isNewRecord);
  }

  /* --- Commandes ------------------------------------------------------ */

  /* Les commandes donnent une direction à l'écran ; la caméra pouvant
     pivoter, on la convertit en direction dans l'arène. */
  /* Direction donnée par le joueur (cap à l'écran), ou null quand il n'en
     donne plus : en contrôle manuel, le cube s'arrête. Pendant la visée
     du dash, les directions orientent la flèche. */
  function steer(screenAngle) {
    heldHeading = screenAngle;
    if (screen !== 'playing') return;
    if (aim) {
      if (screenAngle !== null) aim.angle = renderer.toWorldAngle(screenAngle);
      return;
    }
    if (screenAngle !== null) command({ type: 'steer', angle: renderer.toWorldAngle(screenAngle) });
    else if (settings.control === 'manual') command({ type: 'steer', angle: null });
  }

  /* Une commande du joueur. Chez un invité, elle part chez l'hôte, qui fait
     tourner la partie ; sinon, elle s'applique tout de suite. */
  function command(order) {
    if (online && online.role === 'guest') {
      if (game.mode !== 'online') return;
      // Les gestes produisent beaucoup de caps presque identiques : on n'envoie que les changements.
      if (order.type === 'steer') {
        const same = order.angle === null ? online.lastSteer === null
          : online.lastSteer !== null && Math.abs(Math.sin(order.angle - online.lastSteer)) < 0.02 && Math.cos(order.angle - online.lastSteer) > 0;
        if (same) return;
        online.lastSteer = order.angle;
      }
      online.net.send(order);
      return;
    }
    if (order.type === 'steer') setPlayerHeading(game, order.angle);
    else if (order.kind === 'dash') useDash(game, game.player, order.angle);
    else ABILITY_ACTIONS[order.kind](game, game.player);
  }

  /* Double tap, double clic ou F : en contrôle auto, le cube s'arrête
     jusqu'à la prochaine direction. */
  function halt() {
    if (screen === 'playing' && !aim && settings.control === 'auto') command({ type: 'steer', angle: null });
  }

  /* Compétences : le boost et la bombe partent à l'appui ; le dash se vise
     tant que le bouton (ou E) reste enfoncé, et part au relâchement. */
  function useAbility(kind) {
    if (screen !== 'playing' || !game.player.alive) return;
    if (kind === 'dash') startAim();
    else command({ type: 'ability', kind });
  }

  function startAim() {
    const player = game.player;
    if (player.charges < CONFIG.abilities.dash.cost) return;
    // La flèche part du cap en cours ; avant le départ, vers le haut de l'écran.
    aim = { angle: player.targetAngle !== null ? player.angle : renderer.toWorldAngle(-Math.PI / 2) };
  }

  function aimDash(screenAngle) {
    if (aim) aim.angle = renderer.toWorldAngle(screenAngle);
  }

  function endAbility(kind, cancelled = false) {
    if (kind !== 'dash' || !aim) return;
    const { angle } = aim;
    aim = null;
    if (!cancelled && screen === 'playing') command({ type: 'ability', kind: 'dash', angle });
  }

  /* Contrôle manuel : à la fin du dash, le cube reprend la direction tenue,
     ou s'arrête si on n'en tient aucune. */
  function settleAfterDash() {
    const dashing = Boolean(game.player && isDashing(game.player));
    if (wasDashing && !dashing && settings.control === 'manual') {
      command({ type: 'steer', angle: heldHeading === null ? null : renderer.toWorldAngle(heldHeading) });
    }
    wasDashing = dashing;
  }

  /* --- Options --------------------------------------------------------- */

  function loadSettings() {
    try {
      const saved = JSON.parse(readStorage(STORAGE.settings) || '{}');
      return {
        control: saved.control === 'manual' ? 'manual' : 'auto',
        trail: saved.trail === 'safe' ? 'safe' : 'vulnerable',
      };
    } catch (error) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function openSettings() {
    settingsReturn = screen === 'paused' ? 'paused' : 'home';
    screen = 'settings';
    ui.showSettings(settings);
  }

  /* Les options s'appliquent tout de suite, même à la partie en pause. */
  function changeSetting(key, value) {
    settings = { ...settings, [key]: value };
    writeStorage(STORAGE.settings, JSON.stringify(settings));
    ui.showSettings(settings);
    if (settingsReturn !== 'paused') return;
    if (key === 'trail') {
      game.safeTrail = value === 'safe';
      if (game.safeTrail) game.unranked = true;
    }
    if (key === 'control' && value === 'manual') setPlayerHeading(game, null);
  }

  function closeSettings() {
    if (settingsReturn === 'paused') showPauseScreen();
    else showHomeScreen();
  }

  function confirm() {
    if (screen === 'home') return ui.confirmHome();
    if (screen === 'over') {
      primaryAction();
      return true;
    }
    return false;
  }

  /* --- En ligne -------------------------------------------------------- */

  function defaultNickname() {
    const saved = readStorage(STORAGE.nickname);
    if (saved) return saved;
    return campaign ? campaign.identity.candidate.first : generateCandidates(1)[0].first;
  }

  function lobbyView() {
    return {
      code: online.code, isHost: online.role === 'host', me: online.me,
      players: online.lobby ? online.lobby.players : [], status: online.status, tone: online.tone,
    };
  }

  function showLobbyScreen() {
    if (game.mode === 'online') showMenuGame();
    screen = 'lobby';
    ui.showLobby(lobbyView());
  }

  /* Derrière le salon, comme derrière l'accueil, les IA jouent seules. */
  function showMenuGame() {
    game = createGame({ mode: 'demo' });
    paused = false;
    aim = null;
    renderer.reset(game);
    speech.reset();
    releaseWakeLock();
  }

  function setOnlineStatus(text, tone = '') {
    online.status = text;
    online.tone = tone;
    if (screen === 'lobby') ui.showLobby(lobbyView());
  }

  /* Ferme la connexion et revient à l'accueil. `notice` : message affiché sur la carte « En ligne ». */
  function leaveOnline(notice = '') {
    if (online && online.net) online.net.close();
    online = null;
    showMenu();
    ui.showOnlineNotice(typeof notice === 'string' ? notice : '');
  }

  /* --- Hôte --- */

  function openHosting() {
    if (online) online.net && online.net.close();
    const name = defaultNickname();
    online = {
      role: 'host', code: null, me: 'host', lobby: createLobby({ name, teamKey: TEAMS[0].key }),
      net: null, sync: null, clock: 0, status: 'Ouverture de la partie…', tone: '', lastSteer: null,
      heard: new Map(), pingClock: 0,
    };
    showLobbyScreen();
    const net = openHost({
      onReady: (code) => {
        online.code = code;
        setOnlineStatus('');
      },
      onGuest: () => {},   // il se présente ensuite (message 'hello')
      onMessage: handleGuestMessage,
      onGuestLeft: guestLeft,
      onError: (type) => setOnlineStatus(describeNetError(type), 'error'),
    });
    // openHost peut échouer tout de suite (navigateur sans WebRTC) : online reste sans transport.
    if (online && online.role === 'host') online.net = net;
  }

  function broadcastLobby() {
    if (online.net) online.net.broadcast({ type: 'lobby', code: online.code, players: online.lobby.players });
    if (screen === 'lobby') ui.showLobby(lobbyView());
  }

  function handleGuestMessage(id, message) {
    if (!online || !message) return;
    online.heard.set(id, performance.now());
    if (message.type === 'ping') return;
    if (message.type === 'hello') {
      const playing = game.mode === 'online' && !game.ending;
      const refusal = playing ? 'started' : lobbyJoin(online.lobby, id, message.name, message.teamKey);
      if (refusal) {
        online.net.send(id, { type: 'refused', reason: refusal });
        online.net.drop(id);
        return;
      }
      broadcastLobby();
    } else if (message.type === 'pick') {
      if (lobbyPick(online.lobby, id, message.teamKey)) broadcastLobby();
    } else if (message.type === 'rename') {
      lobbyRename(online.lobby, id, message.name);
      broadcastLobby();
    } else if (game.mode === 'online') {
      applyGuestCommand(game, id, message);
    }
  }

  function guestLeft(id) {
    if (!online) return;
    online.heard.delete(id);
    const player = lobbyLeave(online.lobby, id);
    if (game.mode === 'online') {
      const entity = game.entities.find((item) => item.peer === id);
      if (entity) handOverToBot(entity);
      if (player && screen === 'playing') ui.announce(`${player.name} est parti·e : une IA prend sa place`);
    }
    broadcastLobby();
  }

  function startOnlineMatch() {
    if (!online || online.role !== 'host' || !online.code) return;
    game = createGame({
      mode: 'online',
      humans: online.lobby.players.map(({ peer, name, teamKey }) => ({ peer, name, teamKey })),
    });
    game.unranked = true;
    online.sync = createHostSync(game);
    online.clock = 0;
    online.net.broadcast(online.sync.start());
    beginOnlineGame();
  }

  /* À intervalle régulier, l'hôte envoie à ses invités ce qui a changé. */
  function sendState(dt) {
    online.sync.collect(game.events);
    online.clock += dt;
    if (online.clock < CONFIG.online.sendInterval) return;
    online.clock = 0;
    online.net.broadcast(online.sync.tick());
  }

  /* --- Invité --- */

  function openJoin(code = '') {
    if (online) {
      online.net && online.net.close();
      online = null;
    }
    screen = 'join';
    ui.showJoin({ code: normalizeRoomCode(code), name: defaultNickname() });
  }

  function joinGame(rawCode, rawName) {
    const code = normalizeRoomCode(rawCode);
    if (code.length !== CONFIG.online.codeLength) {
      ui.setJoinStatus(`Le code fait ${CONFIG.online.codeLength} lettres.`, 'error');
      return;
    }
    // Un nouvel essai remplace celui en cours (mauvais code, réseau lent…).
    if (online) {
      if (online.net) online.net.close();
      online = null;
    }
    const name = cleanPlayerName(rawName);
    writeStorage(STORAGE.nickname, name);
    ui.setJoinStatus('Connexion à la partie…');
    online = {
      role: 'guest', code, me: null, lobby: null, net: null, status: '', tone: '', lastSteer: null,
      heardHost: performance.now(), pingClock: 0,
    };
    const net = joinRoom(code, {
      onOpen: (id) => {
        online.me = id;
        online.net.send({ type: 'hello', name });
        ui.setJoinStatus('Connecté·e ! On attend le salon…');
      },
      onMessage: handleHostMessage,
      onClose: () => leaveOnline(describeNetError('closed')),
      onError: (type) => {
        online = null;
        ui.setJoinStatus(describeNetError(type), 'error');
      },
    });
    if (online) online.net = net;
  }

  function handleHostMessage(message) {
    if (!online || !message) return;
    online.heardHost = performance.now();
    if (message.type === 'ping') return;
    if (message.type === 'lobby') {
      online.lobby = { players: message.players };
      online.code = message.code;
      // Pendant une partie, le salon change en coulisse ; on y revient après.
      // L'hôte revenu au salon après une partie y ramène tout le monde.
      if (screen !== 'playing' && screen !== 'paused' && screen !== 'settings') showLobbyScreen();
    } else if (message.type === 'refused') {
      const reason = describeNetError(message.reason);
      online.net.close();
      online = null;
      if (screen === 'join') ui.setJoinStatus(reason, 'error');
      else leaveOnline(reason);
    } else if (message.type === 'start') {
      game = createMirror(message, online.me);
      online.lastSteer = null;
      beginOnlineGame();
    } else if (message.type === 'state' && game.mirror) {
      applyState(game, message);
    }
  }

  /* --- Les deux --- */

  /* Présence : un signe de vie par seconde dans chaque sens. Un invité
     muet trop longtemps est retiré (une IA reprend son joueur) ; un hôte
     muet trop longtemps fait revenir l'invité à l'accueil. */
  function keepAlive(dt) {
    if (!online || !online.net) return;
    online.pingClock += dt;
    if (online.pingClock < CONFIG.online.pingInterval) return;
    online.pingClock = 0;
    const silence = CONFIG.online.silenceTimeout * 1000;
    const now = performance.now();
    if (online.role === 'host') {
      online.net.broadcast({ type: 'ping' });
      for (const [id, heard] of online.heard) {
        if (now - heard < silence) continue;
        online.heard.delete(id);
        online.net.drop(id);
        guestLeft(id);
      }
    } else if (online.me) {
      online.net.send({ type: 'ping' });
      if (now - online.heardHost > silence) leaveOnline('La connexion avec l\'hôte est perdue.');
    }
  }

  function renameOnline(rawName) {
    const name = cleanPlayerName(rawName);
    writeStorage(STORAGE.nickname, name);
    if (!online) return;
    if (online.role === 'host') {
      lobbyRename(online.lobby, 'host', name);
      broadcastLobby();
    } else {
      online.net.send({ type: 'rename', name });
    }
  }

  function pickOnlineTeam(teamKey) {
    if (!online) return;
    if (online.role === 'host') {
      if (lobbyPick(online.lobby, 'host', teamKey)) broadcastLobby();
    } else {
      online.net.send({ type: 'pick', teamKey });
    }
  }

  function beginOnlineGame() {
    screen = 'playing';
    paused = false;
    aim = null;
    wasDashing = false;
    badge = `En ligne · ${online.code}`;
    renderer.reset(game);
    speech.reset();
    minimap.refreshNow();
    ui.showPlaying(game, badge);
    ui.announce('51 % de la France et ton camp l\'emporte !');
    canvas.focus({ preventScroll: true });
    requestWakeLock();
  }

  /* Fin d'une partie en ligne : chacun voit le résultat de son camp, puis
     revient au salon pour la suivante. */
  function endOnlineGame() {
    const myKey = game.lands[game.player.landId - 1].key;
    game.ending.standings = game.ending.standings.map((row) => ({ ...row, isPlayerLand: row.key === myKey }));
    game.ending.cells = game.grid.counts[game.player.landId];
    game.ending.kills = game.player.kills;
    releaseWakeLock();
    primaryAction = () => {
      if (!online) {
        showMenu();
        return;
      }
      showLobbyScreen();
      if (online.role === 'host') broadcastLobby();
    };
    ui.showGameOver(game, 0, false);
  }

  /* Lien d'invitation : le code dans l'adresse (#rejoindre=CODE). */
  async function shareRoom() {
    if (!online || !online.code) return;
    const url = `${location.origin}${location.pathname}#rejoindre=${online.code}`;
    const text = `Viens jouer à DeBattle avec moi ! Code : ${online.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'DeBattle', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setOnlineStatus('Lien copié : colle-le dans un message.');
    } catch (error) {
      if (error && error.name === 'AbortError') return;   // partage annulé
      setOnlineStatus(`Partage impossible ici : donne le code ${online.code}.`);
    }
  }

  /* Pendant une partie en ligne, l'écran reste allumé : chez l'hôte, la
     mise en veille arrêterait la partie pour tout le monde. */
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if (navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } catch (error) {
      wakeLock = null;   // refusé (économie d'énergie…) : on joue quand même
    }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  /* --- Boucle --------------------------------------------------------- */

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, CONFIG.maxFrameTime);
    lastTime = now;

    if (game.mirror) updateMirror(game, dt);
    else if (!paused) updateGame(game, dt);
    if (online && online.role === 'host' && game.mode === 'online') sendState(dt);
    keepAlive(dt);
    if (screen === 'playing') {
      touchInput.update();
      settleAfterDash();
      if (aim && !game.player.alive) aim = null;
    } else {
      aim = null;
    }
    renderer.handleEvents(game);
    if (screen === 'playing') {
      ui.handleEvents(game);
      speech.handleEvents(game);
      speech.update(game, dt);
    }
    game.events.length = 0;
    renderer.draw(game, paused ? 0 : dt, screen === 'playing' ? speech.bubbles : null, aim);

    if (screen === 'playing') {
      minimap.update(game, dt, renderer.getYaw());
      ui.updateHud(game, loadRecordCached());
      ui.updateCompass(renderer.getYaw());
      if (game.over) endGame();
    }
    requestAnimationFrame(frame);
  }

  /* Le record affiché en partie ne change pas pendant la partie : lu une fois. */
  let cachedRecord = { game: null, value: 0 };
  function loadRecordCached() {
    if (cachedRecord.game !== game) cachedRecord = { game, value: loadRecord(game) };
    return cachedRecord.value;
  }

  setupKeyboard({ onHeading: steer, onConfirm: confirm, onAbility: useAbility, onAbilityEnd: endAbility, onHalt: halt, onPause: togglePause });
  const touchInput = setupTouch(canvas, {
    onHeading: steer,
    onDoubleTap: halt,
    followsMouse: () => screen === 'playing' && settings.control === 'manual',
    pointTo: () => (game.player && game.player.alive ? renderer.toCssPoint(game.player.x, game.player.y) : null),
    onZoom: renderer.zoomBy,
    onTilt: renderer.tiltBy,
    onRotate: renderer.rotateBy,
  });
  ui.applySettings(settings);
  window.addEventListener('resize', renderer.resize);
  window.addEventListener('orientationchange', renderer.resize);
  showMenu();
  // Lien d'invitation : on ouvre directement « Rejoindre », code rempli.
  const invitation = location.hash.match(/rejoindre=([A-Za-z]+)/);
  if (invitation) openJoin(invitation[1]);
  requestAnimationFrame(frame);
})();
