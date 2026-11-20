'use strict';

/* Interface de DeBattle : accueil, choix des noms, affichage en
   partie, fin de partie ou de niveau. Le DOM n'est modifié que lorsqu'une
   valeur change réellement. Les textes se veulent drôles, jamais méchants. */

/* Tête de mort du compteur d'éliminations, en cases comme le logo. */
const SKULL_GLYPH = Object.freeze(['.11111.', '1111111', '1..1..1', '1111111', '.11111.', '.1.1.1.']);

/* Compétences, dans l'ordre des boutons. `key` : touche affichée sur ordinateur. */
/* `icon` : tracé SVG dans une case de 24, dessiné au trait.
   `aimed` : se vise bouton enfoncé, part au relâchement. */
const ABILITIES = Object.freeze([
  { kind: 'boost', label: 'Boost', key: 'Espace', icon: 'M5 6l6 6-6 6M13 6l6 6-6 6' },
  { kind: 'dash', label: 'Dash', hint: 'vise, lâche', key: 'E', aimed: true, icon: 'M3 12h12M11 7l5 5-5 5M20 5v14' },
  { kind: 'bomb', label: 'Bombe', key: 'R', icon: 'M12 3.5c3.2 4 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.3-6 5.5-10z' },
]);

/* État d'une compétence pour le joueur :
   - 'active'   : en cours ; `progress` = temps restant ;
   - 'ready'    : utilisable ;
   - 'charging' : `progress` = avancement vers la disponibilité. */
function getAbilityState(game, kind) {
  const player = game.player;
  const settings = CONFIG.abilities[kind];
  if (kind === 'boost' && player.boostTime > 0) {
    return { state: 'active', progress: Math.min(1, player.boostTime / settings.duration) };
  }
  if (kind === 'dash' && isDashing(player)) return { state: 'active', progress: 1 };
  const progress = Math.min(1, player.charges / settings.cost);
  return { state: progress < 1 ? 'charging' : 'ready', progress };
}

/* Ce que fait chaque option, selon l'appareil (tactile ou non). */
const SETTING_NOTES = Object.freeze({
  control: Object.freeze({
    auto: Object.freeze({
      touch: 'Ton cube avance tout seul : glisse le pouce pour le diriger. Pour t\'arrêter, tape deux fois sur l\'écran.',
      desk: 'Ton cube avance tout seul : flèches ou ZQSD pour le diriger. Pour t\'arrêter : double clic, ou F.',
    }),
    manual: Object.freeze({
      touch: 'Ton cube n\'avance que tant que ton pouce est posé : glisse pour le diriger, lève le pouce pour t\'arrêter.',
      desk: 'Ton cube n\'avance que si tu le diriges : flèches ou ZQSD maintenues, ou clic gauche maintenu vers la souris. Lâche tout : il s\'arrête.',
    }),
  }),
  trail: Object.freeze({
    vulnerable: 'Règle normale : si un adversaire touche ta ligne, ou si tu la recoupes, tu perds.',
    safe: 'Personne ne peut couper ta ligne, toi compris. Idéal pour apprendre ; les records ne comptent pas.',
  }),
});

const SETTING_LABELS = Object.freeze({
  control: Object.freeze({ auto: 'contrôle auto', manual: 'contrôle manuel' }),
  trail: Object.freeze({ vulnerable: 'traînée vulnérable', safe: 'traînée protégée' }),
});

/* Indication de départ, selon le contrôle et l'appareil. */
const START_HINTS = Object.freeze({
  auto: Object.freeze({ touch: 'Glisse le pouce pour partir', desk: 'Flèches ou ZQSD pour partir' }),
  manual: Object.freeze({ touch: 'Garde le pouce posé pour avancer', desk: 'Maintiens ZQSD ou le clic pour avancer' }),
});

const ROUND_NAMES = Object.freeze({ 1: 'premier tour', 2: 'second tour' });

/* Comment la partie s'est terminée. */
const ENDING_MESSAGES = Object.freeze({
  victory: () => 'Ton camp atteint 51 % de l\'arène.',
  outpaced: (killerName, winnerName) => `${winnerName} atteint 51 % de l'arène.`,
  splash: (name) => `${name} t'a éclaboussé. Ça tache, une campagne.`,
  self: () => 'Tu as coupé ta propre traînée. Un grand classique du tir ami.',
  cut: (name) => `${name} a coupé ta traînée. Coup bas en pleine campagne !`,
  headon: (name) => `Choc frontal avec ${name}. Un débat un peu trop direct.`,
  eaten: (name) => `${name} a conquis tout ton territoire. Même ta permanence.`,
});

/* Ce que change chaque difficulté, en une phrase. */
const DIFFICULTY_NOTES = Object.freeze({
  normal: 'Éliminé ? Tu réapparais dans la même partie, qui continue jusqu\'à ce que quelqu\'un atteigne 51 %. Dans le duo de tête avec plus d\'un tiers de l\'arène à la fin : finale à deux.',
  chaud: 'Éliminé ? La partie s\'arrête et tu reprends au niveau où tu es tombé. Dans le duo de tête avec plus d\'un tiers de l\'arène : finale à deux.',
  hardcore: 'Éliminé ? Retour au quartier, tout recommence. Deux adversaires de plus à chaque niveau, et pas de finale de rattrapage.',
});

/* Noms des couleurs au choix en solo, dans l'ordre de SOLO_COLORS. */
const COLOR_NAMES = Object.freeze(['Soleil', 'Lagon', 'Fuchsia', 'Pomme', 'Lavande', 'Mandarine', 'Corail', 'Azur']);

/* Campagne : titres de victoire par niveau, et mots de consolation. */
const LEVEL_WON_TITLES = Object.freeze(['Quartier remporté !', 'Ville remportée !', 'Département remporté !', 'Région remportée !', 'Élu·e !']);
const LEVEL_WON_JOKES = Object.freeze([
  'Les voisins t\'adorent. Enfin, 51 % d\'entre eux.',
  'Le maire sortant cherche un nouveau travail.',
  'Ta tête est sur toutes les affiches. Même celles du cinéma.',
  'Tu as serré tant de mains que la tienne demande des congés.',
]);
const CONSOLATIONS = Object.freeze([
  'Les sondages étaient formels… ils avaient tort.',
  'Pas grave : un bon candidat ne lâche jamais rien.',
  'Un café, une relecture du programme, et on y retourne.',
  'Défaite technique. Le recomptage est en cours (non).',
]);

const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];

function formatShare(cells, totalCells) {
  return formatPercent(cells / totalCells);
}

function formatPercent(share) {
  return `${(share * 100).toFixed(2).replace('.', ',')} %`;
}

function buildSkull(container) {
  const unit = 2;
  const rects = [];
  SKULL_GLYPH.forEach((row, y) => {
    [...row].forEach((mark, x) => {
      if (mark === '1') rects.push(`<rect x="${x * unit}" y="${y * unit}" width="${unit}" height="${unit}"/>`);
    });
  });
  container.innerHTML =
    `<svg viewBox="0 0 ${SKULL_GLYPH[0].length * unit} ${SKULL_GLYPH.length * unit}" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`;
}

/* `onCampaign(fresh)` : lancer ou reprendre la campagne ; `onTeam(teamKey)` :
   jouer en équipes ; `onPrimary` : bouton principal de l'écran de fin.
   `pause` : { open, resume, rename, color(index), difficulty(key), team(key),
   campaign } , les commandes de l'écran de pause. */
function createUI({
  onCampaign, onTeam, onDifficulty, onPrimary, onMenu, onAbility, onAbilityEnd, onAim, onResetCamera, pause, settings, online,
}) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    hud: byId('hud'),
    share: byId('hud-share'),
    score: byId('hud-score'),
    best: byId('hud-best'),
    safeBadge: byId('hud-safe'),
    settingsScreen: byId('screen-settings'),
    settingOptions: [...document.querySelectorAll('[data-setting]')],
    settingNotes: { control: byId('setting-control-note'), trail: byId('setting-trail-note') },
    settingsSummary: byId('settings-summary'),
    join: byId('screen-join'),
    joinCode: byId('join-code'),
    joinName: byId('join-name'),
    joinStatus: byId('join-status'),
    lobby: byId('screen-lobby'),
    lobbyCode: byId('lobby-code'),
    lobbyHint: byId('lobby-hint'),
    lobbyName: byId('lobby-name'),
    lobbyTeams: byId('lobby-teams'),
    lobbyPlayers: byId('lobby-players'),
    lobbyPlayersTitle: byId('lobby-players-title'),
    lobbyStatus: byId('lobby-status'),
    lobbyStart: byId('btn-lobby-start'),
    onlineNotice: byId('online-notice'),
    pauseTeamGroup: byId('pause-team-group'),
    pauseMenu: byId('btn-pause-menu'),
    roundBadge: byId('hud-round'),
    compass: byId('compass'),
    kills: byId('hud-kills'),
    region: byId('hud-region'),
    announcement: byId('announcement'),
    abilities: byId('abilities'),
    charges: byId('charges'),
    abilityButtons: byId('ability-buttons'),
    minimap: byId('minimap'),
    ranking: byId('ranking'),
    hint: byId('start-hint'),
    home: byId('screen-home'),
    campaignSteps: byId('campaign-steps'),
    campaignStatus: byId('campaign-status'),
    campaignButton: byId('btn-campaign'),
    campaignNewButton: byId('btn-campaign-new'),
    difficultyOptions: [...document.querySelectorAll('[data-difficulty]')],
    difficultyNote: byId('difficulty-note'),
    teamButtons: byId('team-buttons'),
    pick: byId('screen-pick'),
    pickTitle: byId('pick-title'),
    pickText: byId('pick-text'),
    pickOptions: byId('pick-options'),
    pickReroll: byId('btn-pick-reroll'),
    pickBack: byId('btn-pick-back'),
    pickCustom: byId('pick-custom'),
    pickInput: byId('pick-input'),
    pause: byId('screen-pause'),
    pauseWhere: byId('pause-where'),
    pauseYou: byId('pause-you'),
    pauseName: byId('pause-name'),
    pauseColors: byId('pause-colors'),
    pauseDifficultyGroup: byId('pause-difficulty-group'),
    pauseDifficulties: [...document.querySelectorAll('[data-pause-difficulty]')],
    pauseTeamTitle: byId('pause-team-title'),
    pauseTeams: byId('pause-teams'),
    pauseCampaign: byId('pause-campaign'),
    pauseCampaignButton: byId('btn-pause-campaign'),
    over: byId('screen-over'),
    overRibbon: byId('over-ribbon'),
    overTitle: byId('over-title'),
    overSteps: byId('over-steps'),
    overReason: byId('over-reason'),
    overStandings: byId('over-standings'),
    standingsLabel: byId('standings-label'),
    overScore: byId('over-score'),
    overKills: byId('over-kills'),
    overBest: byId('over-best'),
    overRecord: byId('over-record'),
    primary: byId('btn-primary'),
  };
  const usesTouch = window.matchMedia('(pointer: coarse)').matches;
  const screens = [elements.home, elements.pick, elements.pause, elements.settingsScreen, elements.join, elements.lobby, elements.over];
  const playOnly = [elements.hud, elements.abilities, elements.minimap, elements.compass, elements.hint];
  let lastTeamKey = null;
  let hasSavedCampaign = false;
  let picker = null;            // choix de nom en cours : { onPick, onReroll, onBack }
  let rankingSignature = '';
  let regionRefreshAt = 0;      // prochaine mise à jour de la ligne « région », en millisecondes
  let completeRegions = new Int32Array(256);   // régions entièrement tenues par chaque camp
  const celebrateUntil = new Map();            // camp -> fin de la mise en avant de sa ligne, en millisecondes

  buildSkull(byId('hud-skull'));
  buildTeamButtons();
  const pauseTeamButtons = buildPauseTeams();
  const swatches = buildSwatches();
  const abilityControls = buildAbilityControls();
  const device = usesTouch ? 'touch' : 'desk';
  for (const option of elements.settingOptions) {
    option.addEventListener('click', () => settings.change(option.dataset.setting, option.dataset.value));
  }
  byId('btn-settings').addEventListener('click', settings.open);
  byId('btn-pause-settings').addEventListener('click', settings.open);
  byId('btn-settings-close').addEventListener('click', settings.close);
  byId('btn-host').addEventListener('click', online.host);
  byId('btn-join').addEventListener('click', () => online.join(''));
  byId('btn-join-back').addEventListener('click', online.back);
  byId('join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    online.joinSubmit(elements.joinCode.value, elements.joinName.value);
  });
  elements.joinCode.addEventListener('input', () => {
    elements.joinCode.value = normalizeRoomCode(elements.joinCode.value);
  });
  byId('btn-share').addEventListener('click', online.share);
  byId('btn-lobby-leave').addEventListener('click', online.leave);
  elements.lobbyStart.addEventListener('click', online.start);
  elements.lobbyName.addEventListener('change', () => online.rename(elements.lobbyName.value));
  const lobbyTeamButtons = TEAMS.map((team) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-team';
    button.dataset.team = team.key;
    paintSlab(button, team.colors);
    button.addEventListener('click', () => online.pickTeam(team.key));
    elements.lobbyTeams.append(button);
    return button;
  });
  elements.campaignButton.addEventListener('click', () => onCampaign(false));
  elements.campaignNewButton.addEventListener('click', () => onCampaign(true));
  for (const option of elements.difficultyOptions) {
    option.addEventListener('click', () => {
      selectDifficulty(option.dataset.difficulty);
      onDifficulty(option.dataset.difficulty);
    });
  }
  elements.pickReroll.addEventListener('click', () => picker && picker.onReroll());
  elements.pickBack.addEventListener('click', () => picker && picker.onBack());
  elements.pickCustom.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = elements.pickInput.value.replace(/\s+/g, ' ').trim();
    if (name && picker) picker.onPick(name);
  });
  byId('btn-pause').addEventListener('click', pause.open);
  byId('btn-resume').addEventListener('click', pause.resume);
  byId('btn-rename').addEventListener('click', pause.rename);
  byId('btn-pause-menu').addEventListener('click', onMenu);
  elements.pauseCampaignButton.addEventListener('click', pause.campaign);
  for (const option of elements.pauseDifficulties) {
    option.addEventListener('click', () => pause.difficulty(option.dataset.pauseDifficulty));
  }
  elements.primary.addEventListener('click', onPrimary);
  byId('btn-menu').addEventListener('click', onMenu);
  elements.compass.addEventListener('click', onResetCamera);

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function paintSlab(element, colors) {
    element.style.setProperty('--slab', colors.main);
    element.style.setProperty('--slab-side', colors.dark);
    element.style.setProperty('--slab-text', colors.text);
  }

  /* Un seul écran à la fois ; l'affichage de jeu n'apparaît qu'en partie. */
  function showScreen(screen) {
    for (const element of screens) element.hidden = element !== screen;
    for (const element of playOnly) element.hidden = true;
  }


  /* Étapes de la campagne : faites, en cours, à venir. */
  function renderSteps(list, current, wonCurrent = false) {
    list.replaceChildren(...CAMPAIGN.levels.map((level, index) => {
      const step = document.createElement('li');
      const done = index < current || (index === current && wonCurrent);
      step.className = done ? 'is-done' : index === current ? 'is-current' : '';
      step.textContent = level.name;
      return step;
    }));
  }

  /* --- Accueil ------------------------------------------------------ */

  /* Un bouton par équipe, à ses couleurs : choisir son camp lance la partie. */
  function buildTeamButtons() {
    for (const team of TEAMS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-team';
      button.textContent = team.name;
      paintSlab(button, team.colors);
      button.addEventListener('click', () => {
        lastTeamKey = team.key;
        onTeam(team.key);
      });
      elements.teamButtons.append(button);
    }
  }

  /* --- Pause -------------------------------------------------------- */

  /* Les camps, pour en changer ou passer en équipes depuis la campagne. */
  function buildPauseTeams() {
    return TEAMS.map((team) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-team';
      button.textContent = team.name;
      button.dataset.team = team.key;
      paintSlab(button, team.colors);
      button.addEventListener('click', () => {
        lastTeamKey = team.key;
        pause.team(team.key);
      });
      elements.pauseTeams.append(button);
      return button;
    });
  }

  /* Une pastille par couleur au choix en solo. */
  function buildSwatches() {
    return SOLO_COLORS.map((colors, index) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-label', COLOR_NAMES[index]);
      swatch.title = COLOR_NAMES[index];
      paintSlab(swatch, colors);
      swatch.addEventListener('click', () => pause.color(index));
      elements.pauseColors.append(swatch);
      return swatch;
    });
  }

  /* `info` : { mode, where, name, colorIndex, difficulty, teamKey, hasCampaign }.
     En campagne : nom, couleur, difficulté, et les camps pour passer en
     équipes. En équipes : changer de camp, ou passer à la campagne. */
  function showPause(info) {
    const isCampaign = info.mode === 'solo';
    const isOnline = info.mode === 'online';
    showScreen(elements.pause);
    setText(elements.pauseWhere, isOnline ? `${info.where} · la partie continue pendant ce temps` : info.where);
    elements.pauseYou.hidden = !isCampaign;
    elements.pauseDifficultyGroup.hidden = !isCampaign;
    elements.pauseCampaign.hidden = isCampaign || isOnline;
    elements.pauseTeamGroup.hidden = isOnline;
    setText(elements.pauseMenu, isOnline ? 'Quitter la partie' : 'Menu principal');
    if (isCampaign) {
      setText(elements.pauseName, info.name);
      swatches.forEach((swatch, index) => swatch.setAttribute('aria-checked', String(index === info.colorIndex)));
      for (const option of elements.pauseDifficulties) {
        option.setAttribute('aria-checked', String(option.dataset.pauseDifficulty === info.difficulty));
      }
    }
    setText(elements.pauseTeamTitle, isCampaign ? 'Passer en équipes' : 'Ton camp · nouvelle partie');
    for (const button of pauseTeamButtons) {
      button.classList.toggle('is-current', !isCampaign && button.dataset.team === info.teamKey);
    }
    setText(elements.pauseCampaignButton, info.hasCampaign ? 'Continuer ma campagne' : 'Lancer ma campagne');
    byId('btn-resume').focus({ preventScroll: true });
  }

  /* Retour en partie après la pause, sans remettre l'affichage à zéro ;
     la couleur et le nom du joueur ont pu changer. */
  function resumePlaying(game) {
    for (const element of screens) element.hidden = true;
    elements.hud.hidden = false;
    elements.abilities.hidden = false;
    elements.minimap.hidden = false;
    paintSlab(elements.share, playerLand(game).colors);
    paintSlab(elements.abilities, playerLand(game).colors);
    elements.safeBadge.hidden = !game.safeTrail;
    rankingSignature = '';
  }

  /* --- Options ------------------------------------------------------ */

  function showSettings(current) {
    showScreen(elements.settingsScreen);
    for (const option of elements.settingOptions) {
      option.setAttribute('aria-checked', String(current[option.dataset.setting] === option.dataset.value));
    }
    setText(elements.settingNotes.control, SETTING_NOTES.control[current.control][device]);
    setText(elements.settingNotes.trail, SETTING_NOTES.trail[current.trail]);
    applySettings(current);
  }

  /* Le contrôle choisi change l'indication de départ ; l'accueil rappelle
     les options en cours. */
  function applySettings(current) {
    elements.hint.textContent = START_HINTS[current.control][device];
    setText(elements.settingsSummary, `${SETTING_LABELS.control[current.control]} · ${SETTING_LABELS.trail[current.trail]}`);
  }

  /* --- En ligne ----------------------------------------------------- */

  function setStatus(element, text, tone = '') {
    setText(element, text);
    element.dataset.tone = tone;
  }

  function showJoin({ code, name }) {
    showScreen(elements.join);
    elements.joinCode.value = code;
    elements.joinName.value = name;
    setStatus(elements.joinStatus, '');
    (code ? elements.joinName : elements.joinCode).focus({ preventScroll: true });
  }

  const setJoinStatus = (text, tone) => setStatus(elements.joinStatus, text, tone);
  const setLobbyStatus = (text, tone) => setStatus(elements.lobbyStatus, text, tone);

  /* `view` : { code, isHost, me, players, status, tone }. */
  function showLobby(view) {
    if (elements.lobby.hidden) {
      showScreen(elements.lobby);
      elements.lobbyName.value = (view.players.find((player) => player.peer === view.me) || {}).name || '';
    }
    setText(elements.lobbyCode, view.code || '····');
    setText(elements.lobbyHint, view.isHost
      ? 'Tes copains ouvrent le lien, ou tapent ce code dans « Rejoindre ». Garde le jeu ouvert : ton appareil fait tourner la partie.'
      : 'Choisis ton camp ; l\'hôte lance la partie quand tout le monde est là.');
    const me = view.players.find((player) => player.peer === view.me);
    for (const button of lobbyTeamButtons) {
      const team = TEAMS.find((item) => item.key === button.dataset.team);
      const count = view.players.filter((player) => player.teamKey === team.key).length;
      button.textContent = `${team.name} · ${count}/${CONFIG.online.maxPerTeam}`;
      button.classList.toggle('is-current', Boolean(me) && me.teamKey === team.key);
      button.classList.toggle('is-full', count >= CONFIG.online.maxPerTeam && !(me && me.teamKey === team.key));
    }
    setText(elements.lobbyPlayersTitle, `Joueurs · ${view.players.length}/${CONFIG.online.maxHumans}`);
    elements.lobbyPlayers.replaceChildren(...view.players.map((player) => {
      const team = TEAMS.find((item) => item.key === player.teamKey);
      const item = document.createElement('li');
      paintSlab(item, team.colors);
      item.classList.toggle('is-me', player.peer === view.me);
      const tag = document.createElement('span');
      tag.className = 'lobby-team';
      tag.textContent = team.name;
      const name = document.createElement('span');
      name.className = 'lobby-name';
      name.textContent = player.name;
      item.append(tag, name);
      if (player.isHost || player.peer === view.me) {
        const role = document.createElement('span');
        role.className = 'lobby-role';
        role.textContent = [player.isHost ? 'hôte' : '', player.peer === view.me ? 'toi' : ''].filter(Boolean).join(' · ');
        item.append(role);
      }
      return item;
    }));
    elements.lobbyStart.hidden = !view.isHost;
    elements.lobbyStart.disabled = !view.code;
    setLobbyStatus(view.status || (view.isHost ? '' : 'En attente de l\'hôte…'), view.tone);
  }

  /* Message sur la carte « En ligne » de l'accueil (l'hôte est parti…). */
  function showOnlineNotice(text) {
    elements.onlineNotice.hidden = !text;
    setText(elements.onlineNotice, text || '');
  }

  function selectDifficulty(difficulty) {
    for (const option of elements.difficultyOptions) {
      option.setAttribute('aria-checked', String(option.dataset.difficulty === difficulty));
    }
    elements.difficultyNote.dataset.difficulty = difficulty;
    setText(elements.difficultyNote, DIFFICULTY_NOTES[difficulty]);
  }

  /* `campaign` : null, ou { level, name } pour une campagne en cours. */
  function showHome(campaign, difficulty) {
    showScreen(elements.home);
    selectDifficulty(difficulty);
    hasSavedCampaign = Boolean(campaign);
    renderSteps(elements.campaignSteps, campaign ? campaign.level : 0);
    elements.campaignStatus.hidden = !campaign;
    elements.campaignNewButton.hidden = !campaign;
    if (campaign) {
      const level = CAMPAIGN.levels[campaign.level];
      setText(elements.campaignStatus, `${campaign.name} · niveau ${campaign.level + 1} sur ${CAMPAIGN.levels.length} : ${level.name}`);
      setText(elements.campaignButton, 'Continuer');
    } else {
      setText(elements.campaignButton, 'Lancer ma campagne');
    }
  }

  /* Entrée / Espace sur l'accueil : reprend la campagne, ou la dernière équipe jouée. */
  function confirmHome() {
    if (lastTeamKey && !hasSavedCampaign) onTeam(lastTeamKey);
    else onCampaign(false);
    return true;
  }

  /* --- Choix d'un nom ------------------------------------------------ */

  /* `options` : noms proposés ; `onPick(name)`, `onReroll()`, `onBack()`. */
  function showPicker({ title, text, options, onPick, onReroll, onBack }) {
    showScreen(elements.pick);
    picker = { onPick, onReroll, onBack };
    elements.pickInput.value = '';
    setText(elements.pickTitle, title);
    setText(elements.pickText, text);
    elements.pickOptions.replaceChildren(...options.map((name, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pick-option';
      button.style.setProperty('--delay', `${index * 60}ms`);
      button.textContent = name;
      button.addEventListener('click', () => onPick(name));
      return button;
    }));
    elements.pickOptions.firstChild.focus({ preventScroll: true });
  }

  /* --- En partie ---------------------------------------------------- */

  function playerLand(game) {
    return game.lands[game.player.landId - 1];
  }

  /* `badge` : ce qu'affiche le badge sous le score (niveau ou tour). */
  function showPlaying(game, badge) {
    for (const element of screens) element.hidden = true;
    elements.hud.hidden = false;
    elements.abilities.hidden = false;
    elements.minimap.hidden = false;
    elements.safeBadge.hidden = !game.safeTrail;
    elements.roundBadge.hidden = !badge;
    setText(elements.roundBadge, badge || '');
    elements.region.hidden = true;
    elements.announcement.hidden = true;
    regionRefreshAt = 0;
    completeRegions = new Int32Array(256);
    celebrateUntil.clear();
    paintSlab(elements.share, playerLand(game).colors);
    paintSlab(elements.abilities, playerLand(game).colors);
    rankingSignature = '';
    resetAbilityControls();
  }

  /* --- Régions ------------------------------------------------------ */

  /* Sous le score : la région où se trouve le joueur, et la part que son
     camp en possède. Recalculée deux fois par seconde au plus. */
  function updateRegion(game) {
    const { grid, player } = game;
    if (grid.regions.length === 0 || performance.now() < regionRefreshAt) return;
    regionRefreshAt = performance.now() + 500;
    completeRegions = countCompleteRegions(grid);
    const regionId = grid.regionOf[cellAt(grid, player.x, player.y)];
    elements.region.hidden = regionId === 0;
    if (regionId === 0) return;
    let owned = 0;
    for (let index = 0; index < grid.owner.length; index++) {
      if (grid.regionOf[index] === regionId && grid.owner[index] === player.landId) owned++;
    }
    const region = grid.regions[regionId - 1];
    setText(elements.region, `${region.name} · ${Math.floor(owned / region.cells * 100)} % sur ${Math.round(CONFIG.regionShare * 100)}`);
  }

  /* Une région complétée : la ligne du camp est mise en avant dans le
     classement, et une annonce s'affiche en haut de l'écran si c'est le tien. */
  function handleEvents(game) {
    if (!game.player) return;
    for (const event of game.events) {
      // En Normal, le joueur éliminé revient : on le lui dit.
      if (event.type === 'death' && event.entity === game.player && !game.ending) {
        announce(`Tombé·e ! Retour dans ${CONFIG.botRespawnDelay} s`);
        continue;
      }
      if (event.type !== 'region') continue;
      celebrateUntil.set(event.landId, performance.now() + 2500);
      regionRefreshAt = 0;
      if (event.landId === game.player.landId) announce(`${ZONE_KINDS[game.grid.zoneKind].done}\u00a0: ${event.name}\u00a0!`);
    }
  }

  /* Annonce brève en haut de l'écran. */
  function announce(text) {
    elements.announcement.textContent = text;
    elements.announcement.hidden = false;
    restartAnimation(elements.announcement);
  }

  function restartAnimation(element) {
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
  }

  /* Boussole : visible dès que la caméra ne regarde plus vers le nord ;
     l'aiguille montre le nord. La toucher ramène la caméra. */
  function updateCompass(yaw) {
    const rotated = Math.abs(yaw) > 0.02;
    if (elements.compass.hidden === rotated) elements.compass.hidden = !rotated;
    if (rotated) elements.compass.style.setProperty('--heading', `${-yaw}rad`);
  }

  /* --- Compétences -------------------------------------------------- */

  /* Dix pastilles de charge, puis une icône ronde par compétence. Un
     anneau autour de l'icône dit où elle en est : il se remplit avec les
     charges (ou l'attente, pour le stop), puis se vide pendant que la
     compétence agit. Coût en pastille, nom et touche à côté sur ordinateur.
     Les boutons réagissent dès l'appui et ne prennent pas le focus : le
     clavier a ses propres touches. */
  function buildAbilityControls() {
    const pips = [];
    for (let i = 0; i < CONFIG.abilities.maxCharges; i++) {
      const pip = document.createElement('span');
      pip.addEventListener('animationend', () => pip.classList.remove('is-new'));
      elements.charges.append(pip);
      pips.push(pip);
    }
    const buttons = ABILITIES.map((ability) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'ability';
      button.innerHTML =
        '<svg class="ability-ring" viewBox="0 0 52 52" aria-hidden="true">' +
        '<circle class="ring-track" cx="26" cy="26" r="24"/>' +
        '<circle class="ring-fill" cx="26" cy="26" r="24" pathLength="100"/></svg>' +
        `<svg class="ability-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ability.icon}"/></svg>`;
      const cost = CONFIG.abilities[ability.kind].cost;
      if (cost > 0) {
        const badge = document.createElement('span');
        badge.className = 'ability-cost';
        badge.textContent = String(cost);
        button.append(badge);
      }
      const hint = document.createElement('span');
      hint.className = 'ability-hint';
      const name = document.createElement('span');
      const key = document.createElement('kbd');
      key.textContent = ability.key;
      hint.append(name, key);
      button.append(hint);
      if (ability.aimed) watchAim(button, ability.kind);
      else {
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          onAbility(ability.kind);
        });
      }
      button.addEventListener('animationend', () => button.classList.remove('is-popping'));
      elements.abilityButtons.append(button);
      return { ability, button, name, fill: button.querySelector('.ring-fill'), state: null, progress: null, label: null };
    });
    return { pips, buttons, charges: 0 };
  }

  /* Compétence visée : appuyer commence la visée, glisser le doigt (ou la
     souris) depuis le bouton oriente la flèche, relâcher déclenche. */
  function watchAim(button, kind) {
    let pointer = null;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (pointer) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try { button.setPointerCapture(event.pointerId); } catch (error) { /* déjà relâché */ }
      onAbility(kind);
    });
    button.addEventListener('pointermove', (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const deltaX = event.clientX - pointer.x;
      const deltaY = event.clientY - pointer.y;
      if (Math.hypot(deltaX, deltaY) > CONFIG.touch.deadZone) onAim(Math.atan2(deltaY, deltaX));
    });
    const finish = (cancelled) => (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      pointer = null;
      onAbilityEnd(kind, cancelled);
    };
    button.addEventListener('pointerup', finish(false));
    button.addEventListener('pointercancel', finish(true));
  }

  /* Nouvelle partie : les boutons repartent de zéro, sans animation. */
  function resetAbilityControls() {
    abilityControls.charges = 0;
    for (const control of abilityControls.buttons) {
      control.state = null;
      control.button.classList.remove('is-popping');
    }
    for (const pip of abilityControls.pips) pip.classList.remove('is-new');
  }

  function updateCharges(charges) {
    const previous = abilityControls.charges;
    if (charges === previous) return;
    abilityControls.pips.forEach((pip, index) => {
      pip.classList.toggle('is-full', index < charges);
      if (index >= previous && index < charges) pip.classList.add('is-new');
    });
    abilityControls.charges = charges;
  }

  function updateAbilityButton(game, control) {
    const { ability, button } = control;
    const { state, progress } = getAbilityState(game, ability.kind);
    if (state !== control.state) {
      // Une compétence qui devient disponible le signale d'un petit bond.
      const becameReady = state === 'ready' && control.state !== null && control.state !== 'active';
      button.dataset.state = state;
      if (becameReady) {
        button.classList.remove('is-popping');
        restartAnimation(button);
        button.classList.add('is-popping');
      }
      control.state = state;
    }
    const percent = Math.round(progress * 100);
    if (percent !== control.progress) {
      control.fill.style.strokeDashoffset = String(100 - percent);
      control.progress = percent;
    }
    const label = ability.hint && !usesTouch ? `${ability.label} · ${ability.hint}` : ability.label;
    if (label !== control.label) {
      control.name.textContent = label;
      button.setAttribute('aria-label', label);
      control.label = label;
    }
  }

  function updateAbilities(game) {
    updateCharges(game.player.charges);
    for (const control of abilityControls.buttons) updateAbilityButton(game, control);
  }

  /* --- Classement --------------------------------------------------- */

  /* Les trois premiers camps, plus celui du joueur s'il est plus loin. */
  function rankingRows(game) {
    const now = performance.now();
    const ranked = game.lands
      .map((land) => ({
        land,
        cells: getLandCells(game, land),
        regions: completeRegions[land.id],
        celebrating: (celebrateUntil.get(land.id) || 0) > now,
      }))
      .filter((row) => row.cells > 0)
      .sort((a, b) => b.cells - a.cells)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    return ranked.filter((row) => row.rank <= 3 || row.land.isPlayerLand);
  }

  function rankingItem(row, totalCells, zoneKind) {
    const item = document.createElement('li');
    paintSlab(item, row.land.colors);
    if (row.land.isPlayerLand) item.classList.add('is-player');
    const rank = document.createElement('span');
    rank.className = 'ranking-rank';
    rank.textContent = String(row.rank);
    const name = document.createElement('span');
    name.className = 'ranking-name';
    name.textContent = row.land.name;
    const share = document.createElement('span');
    share.textContent = formatShare(row.cells, totalCells);
    item.append(rank, name, share);
    if (row.regions > 0) {
      const regions = document.createElement('span');
      regions.className = 'ranking-regions';
      const kind = ZONE_KINDS[zoneKind];
      regions.textContent = `${row.regions} ${kind.short}`;
      regions.title = `${row.regions} ${row.regions > 1 ? kind.many : kind.one} tenu${kind.done.endsWith('e') ? 'e' : ''}${row.regions > 1 ? 's' : ''} en entier`;
      item.append(regions);
    }
    if (row.celebrating) item.classList.add('is-celebrating');
    return item;
  }

  function updateRanking(game, totalCells) {
    const rows = rankingRows(game);
    const signature = rows.map((row) => `${row.rank}:${row.land.id}:${row.cells}:${row.regions}:${row.celebrating}`).join('|');
    if (signature === rankingSignature) return;
    rankingSignature = signature;
    elements.ranking.replaceChildren(...rows.map((row) => rankingItem(row, totalCells, game.grid.zoneKind)));
  }

  function updateHud(game, bestShare) {
    const player = game.player;
    if (!player || !player.alive) return;
    const totalCells = game.grid.playableCount;
    const cells = getLandCells(game, playerLand(game));
    setText(elements.share, formatShare(cells, totalCells));
    setText(elements.score, String(cellsToScore(game, cells)));
    setText(elements.best, bestShare > 0 ? formatPercent(Math.max(bestShare, cells / totalCells)) : '—');
    setText(elements.kills, String(player.kills));
    updateRanking(game, totalCells);
    updateRegion(game);
    updateAbilities(game);
    elements.hint.hidden = player.targetAngle !== null;
  }

  /* --- Fin de partie ou de niveau ------------------------------------ */

  /* Résultats façon soirée électorale : la part d'arène de chaque camp, du
     premier au dernier, le premier mis en avant. Une barre pleine vaut 51 %,
     le seuil de victoire. */
  function standingItem(row, totalCells, isLeader) {
    const item = document.createElement('li');
    if (isLeader) item.className = 'is-leader';
    if (row.isPlayerLand) item.classList.add('is-player');
    const name = document.createElement('span');
    name.className = 'standing-name';
    name.textContent = row.name;
    const track = document.createElement('span');
    track.className = 'standing-track';
    const bar = document.createElement('span');
    bar.className = 'standing-bar';
    bar.style.width = `${Math.min(1, row.cells / (totalCells * CONFIG.winShare)) * 100}%`;
    bar.style.background = row.colors.main;
    bar.style.boxShadow = `inset 0 -3px 0 ${row.colors.dark}`;
    track.append(bar);
    const share = document.createElement('span');
    share.className = 'standing-share';
    share.textContent = formatShare(row.cells, totalCells);
    item.append(name, share, track);
    return item;
  }

  function showStandings(standings, totalCells) {
    elements.overStandings.replaceChildren(
      ...standings.map((row, index) => standingItem(row, totalCells, index === 0)));
  }

  /* En équipes : la cause de la fin, puis ce qu'elle décide pour la suite. */
  function teamEndingMessage(ending) {
    const cause = ENDING_MESSAGES[ending.reason](ending.killerName, ending.winnerName);
    const round = ROUND_NAMES[ending.round];
    if (ending.reason === 'victory' || ending.reason === 'outpaced') return `${cause} Élu au ${round}.`;
    if (ending.qualified) return `${cause} Ton camp arrive en tête avec plus d'un tiers du pays : second tour face à ${ending.opponent.name} !`;
    if (ending.round === 2) return `${cause} Au décompte, ${ending.winnerName} l'emporte.`;
    if (ending.standings[0].isPlayerLand) return `${cause} Ton camp est en tête, mais sous le tiers du pays : pas de second tour.`;
    return `${cause} Ton camp n'est pas en tête : pas de second tour.`;
  }

  /* Titre, message et bouton principal de l'écran de fin. */
  function describeEnding(game) {
    const ending = game.ending;
    if (game.mode === 'online') {
      const won = isOnlineWin(game);
      return {
        title: won ? 'Élu·e !' : 'Battu·e…',
        tone: won ? 'win' : 'lose',
        message: won
          ? `Ton camp atteint 51 % de la France. ${pickLine(LEVEL_WON_JOKES)}`
          : `${ending.winnerName} atteint 51 % de la France. ${pickLine(CONSOLATIONS)}`,
        primary: 'Revenir au salon',
        standings: 'Résultats',
      };
    }
    if (game.mode === 'team') {
      return {
        title: ending.qualified ? 'Qualifié !' : ending.won ? 'Élu·e !' : 'Battu·e…',
        tone: ending.qualified || ending.won ? 'win' : 'lose',
        message: teamEndingMessage(ending),
        primary: ending.qualified ? 'Second tour' : 'Rejouer',
        standings: `Résultats du ${ROUND_NAMES[ending.round]}`,
      };
    }
    const level = CAMPAIGN.levels[game.level];
    const isFinal = game.level === CAMPAIGN.levels.length - 1;
    const cause = ENDING_MESSAGES[ending.reason](ending.killerName, ending.winnerName);
    if (ending.qualified) {
      return {
        title: 'Finale !',
        tone: 'win',
        message: `${cause} Tu finis dans le duo de tête avec plus d'un tiers de l'arène : finale contre ${ending.opponent.name} pour départager !`,
        primary: 'Jouer la finale',
        standings: `Résultats · ${level.name}`,
      };
    }
    if (ending.won) {
      const next = isFinal ? null : CAMPAIGN.levels[game.level + 1];
      const nextStep = isFinal
        ? 'Campagne terminée : le pays est à toi. Enfin, 51 % du pays.'
        : game.level + 1 === CAMPAIGN.partyFromLevel
          ? 'Ton mouvement grandit : il est temps de lui donner un nom.'
          : `Prochaine étape : ${next.goal}.`;
      const finalWon = game.round === 2 ? 'Finale remportée ! ' : '';
      return {
        title: LEVEL_WON_TITLES[game.level],
        tone: 'win',
        message: `${finalWon}${pickLine(LEVEL_WON_JOKES)} ${nextStep}`,
        primary: isFinal ? 'Nouvelle campagne' : 'Niveau suivant',
        standings: `Résultats · ${level.name}`,
      };
    }
    const finalLost = game.round === 2 ? ` Finale perdue : ${ending.winnerName || 'ton adversaire'} l'emporte.` : '';
    if (CAMPAIGN.difficulties[game.difficulty].restart === 'start') {
      return {
        title: 'Retour à la case départ',
        tone: 'lose',
        message: `${cause}${finalLost} Hardcore oblige, tout recommence au quartier. Courage !`,
        primary: `Recommencer : ${CAMPAIGN.levels[0].name}`,
        standings: `Résultats · ${level.name}`,
      };
    }
    return {
      title: 'Battu·e…',
      tone: 'lose',
      message: `${cause}${finalLost} ${pickLine(CONSOLATIONS)}`,
      primary: `Reprendre : ${level.name}`,
      standings: `Résultats · ${level.name}`,
    };
  }

  function showGameOver(game, bestShare, isNewRecord) {
    const ending = game.ending;
    const totalCells = game.grid.playableCount;
    const text = describeEnding(game);
    showScreen(elements.over);
    setText(elements.overTitle, text.title);
    elements.overRibbon.dataset.tone = text.tone;
    setText(elements.overReason, text.message);
    setText(elements.standingsLabel, text.standings);
    setText(elements.primary, text.primary);
    elements.overSteps.hidden = game.mode !== 'solo';
    elements.primary.hidden = false;
    if (game.mode === 'solo') renderSteps(elements.overSteps, game.level, ending.won);
    showStandings(ending.standings, totalCells);
    setText(elements.overKills, String(ending.kills));
    setText(elements.overScore, String(cellsToScore(game, ending.cells)));
    setText(elements.overBest, bestShare > 0 ? formatPercent(bestShare) : '—');
    elements.overRecord.hidden = !isNewRecord;
    elements.primary.focus({ preventScroll: true });
  }

  return {
    showHome, confirmHome, showPicker, showPlaying, showPause, resumePlaying, updateHud, updateCompass,
    handleEvents, announce, showGameOver, showSettings, applySettings,
    showJoin, setJoinStatus, showLobby, setLobbyStatus, showOnlineNotice,
  };
}
