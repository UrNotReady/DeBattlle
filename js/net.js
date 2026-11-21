'use strict';

/* Transport des parties en ligne, avec PeerJS (WebRTC, vendor/peerjs.min.js).
   L'hôte ouvre un pair nommé CONFIG.online.idPrefix + code ; les invités
   s'y connectent avec ce code. Le serveur PeerJS ne sert qu'à la mise en
   relation : ensuite, les messages vont directement d'un appareil à
   l'autre, en JSON, sur un canal fiable et ordonné. */

function makeRoomCode(random = Math.random) {
  const { codeLetters, codeLength } = CONFIG.online;
  let code = '';
  for (let i = 0; i < codeLength; i++) code += codeLetters[Math.floor(random() * codeLetters.length)];
  return code;
}

/* Code tapé par un joueur : majuscules, lettres seulement. */
function normalizeRoomCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CONFIG.online.codeLength);
}

/* Serveurs utilisés pour relier deux appareils : STUN pour le chemin
   direct, et un relais (TURN) quand on en a configuré un. Les identifiants
   du relais sont demandés une fois ; sans réponse, on joue sans relais. */
let iceServersRequest = null;

function loadIceServers() {
  if (iceServersRequest) return iceServersRequest;
  const stun = [...CONFIG.online.stunServers.map((urls) => ({ urls })), ...CONFIG.online.relayServers];
  const url = CONFIG.online.relayCredentialsUrl;
  if (!url) {
    iceServersRequest = Promise.resolve(stun);
    return iceServersRequest;
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), 6000);
  iceServersRequest = fetch(url, controller ? { signal: controller.signal } : {})
    .then((response) => (response.ok ? response.json() : []))
    .then((relays) => [...stun, ...(Array.isArray(relays) ? relays : [])])
    .catch(() => stun)
    .finally(() => clearTimeout(timer));
  return iceServersRequest;
}

function peerOptions(iceServers) {
  return { debug: 0, config: { iceServers }, ...(CONFIG.online.server || {}) };
}

/* Erreurs, dites au joueur. */
const NET_ERRORS = Object.freeze({
  'peer-unavailable': 'Aucune partie avec ce code. Vérifie-le auprès de l\'hôte.',
  network: 'Impossible de joindre le service de mise en relation. Vérifie ta connexion internet.',
  'server-error': 'Le service de mise en relation ne répond pas. Réessaie dans un instant.',
  'socket-error': 'Le service de mise en relation ne répond pas. Réessaie dans un instant.',
  'browser-incompatible': 'Ce navigateur ne permet pas de jouer en ligne.',
  'unsupported': 'Ce navigateur ne permet pas de jouer en ligne.',
  timeout: 'Pas de réponse de la partie : elle est peut-être fermée, ou vos réseaux empêchent les appareils de se parler directement (fréquent en partage de connexion ou en 4G). Essayez sur le même Wi-Fi.',
  full: 'La partie est complète (six joueurs).',
  started: 'La partie a déjà commencé : attends la prochaine.',
  closed: 'L\'hôte a fermé la partie.',
});

function describeNetError(type) {
  return NET_ERRORS[type] || 'La connexion a échoué. Réessaie dans un instant.';
}

/* Ouvre une partie. Rappels : onReady(code), onGuest(id), onMessage(id,
   message), onGuestLeft(id), onError(type). */
function openHost({ onReady, onGuest, onMessage, onGuestLeft, onError }) {
  if (typeof Peer !== 'function') {
    onError('unsupported');
    return null;
  }
  const connections = new Map();
  let peer = null;
  let attempts = 0;
  let closed = false;

  function listen(connection) {
    connection.on('open', () => {
      connections.set(connection.peer, connection);
      onGuest(connection.peer);
    });
    connection.on('data', (data) => onMessage(connection.peer, data));
    const drop = () => {
      if (connections.delete(connection.peer)) onGuestLeft(connection.peer);
    };
    connection.on('close', drop);
    connection.on('error', drop);
  }

  function open(iceServers) {
    if (closed) return;
    const code = makeRoomCode();
    peer = new Peer(CONFIG.online.idPrefix + code, peerOptions(iceServers));
    peer.on('open', () => onReady(code));
    peer.on('connection', listen);
    peer.on('error', (error) => {
      // Code déjà pris par une autre partie : on en tire un autre.
      if (error.type === 'unavailable-id' && attempts++ < 3) {
        peer.destroy();
        loadIceServers().then(open);
        return;
      }
      if (!closed) onError(error.type);
    });
    // La mise en relation a décroché : les invités déjà connectés restent,
    // on se réinscrit pour en accueillir d'autres.
    peer.on('disconnected', () => {
      if (!closed && !peer.destroyed) peer.reconnect();
    });
  }

  loadIceServers().then(open);
  return {
    send(id, message) {
      const connection = connections.get(id);
      if (connection && connection.open) connection.send(message);
    },
    broadcast(message) {
      for (const connection of connections.values()) if (connection.open) connection.send(message);
    },
    drop(id) {
      const connection = connections.get(id);
      connections.delete(id);
      if (connection) setTimeout(() => connection.close(), 300);   // laisse partir le dernier message
    },
    close() {
      closed = true;
      if (peer) peer.destroy();
    },
  };
}

/* Rejoint la partie `code`. Rappels : onOpen(id) (id : identifiant de cet
   appareil pour l'hôte), onMessage(message), onClose(), onError(type). */
function joinRoom(code, { onOpen, onMessage, onClose, onError }) {
  if (typeof Peer !== 'function') {
    onError('unsupported');
    return null;
  }
  let peer = null;
  let connection = null;
  let opened = false;
  let finished = false;

  const finish = () => {
    finished = true;
    clearTimeout(timer);
    if (peer) peer.destroy();
  };
  const fail = (type) => {
    if (finished) return;
    finish();
    onError(type);
  };
  const timer = setTimeout(() => fail('timeout'), CONFIG.online.connectTimeout * 1000);

  loadIceServers().then((iceServers) => {
    if (finished) return;
    peer = new Peer(peerOptions(iceServers));
    peer.on('open', () => {
      connection = peer.connect(CONFIG.online.idPrefix + code, { reliable: true, serialization: 'json' });
      connection.on('open', () => {
        opened = true;
        clearTimeout(timer);
        onOpen(peer.id);
      });
      connection.on('data', (data) => {
        if (!finished) onMessage(data);
      });
      connection.on('close', () => {
        if (!opened || finished) return;
        finish();
        onClose();
      });
    });
    peer.on('error', (error) => {
      if (!opened) fail(error.type);
    });
  });

  return {
    send(message) {
      if (connection && connection.open) connection.send(message);
    },
    close: () => {
      if (!finished) finish();
    },
  };
}
