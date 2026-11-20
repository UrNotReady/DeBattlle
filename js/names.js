'use strict';

/* Noms et répliques de DeBattle. Tout est inventé : aucun nom de
   personne ni de parti réels. Aucune dépendance au DOM ; chaque générateur
   accepte un tirage aléatoire `random` (Math.random par défaut) pour les tests. */

const FIRST_NAMES = Object.freeze([
  'Josiane', 'Gérard', 'Sandrine', 'Patrick', 'Huguette', 'Jean-Marc', 'Ginette', 'Thierry',
  'Martine', 'Didier', 'Odile', 'Bernard', 'Nadia', 'Kévin', 'Yvette', 'Rachid', 'Chantal',
  'Lucien', 'Fatou', 'Bruno', 'Solange', 'Mehdi', 'Colette', 'Pascal',
]);

const LAST_NAMES = Object.freeze([
  'Bulletin', 'Isoloir', 'Tract', 'Promesse', 'Scrutin', 'Ballottage', 'Mandat', 'Sondage',
  'Pognon', 'Rondpoint', 'Pancarte', 'Duvote', 'Mégaphone', 'Programme', 'Meeting', 'Slogan',
  'Tribune', 'Estrade', 'Affiche', 'Urnebelle', 'Débat', 'Motion',
]);

/* Noms de partis tirés du candidat… */
const PARTY_PATTERNS = Object.freeze([
  (first, last) => `Parti ${last}`,
  (first, last) => `Union ${last}`,
  (first, last) => `Mouvement ${last}`,
  (first, last) => `Collectif ${last}`,
  (first, last) => `Alliance ${last}`,
  (first) => `Les Amis de ${first}`,
]);

/* … ou complètement farfelus. */
const PARTY_FANCIES = Object.freeze([
  'Parti de la Sieste', 'Union des Ronds-Points', 'Mouvement du Bon Sens', 'Ligue des Trottinettes',
  'Parti de la Baguette Tiède', 'Coalition des Apéros', 'Collectif des Voisins Bruyants',
  'Parti du Café Gratuit', 'Mouvement Lundi Férié', 'Union des Pétanqueurs', 'Ligue du Plat du Jour',
  'Parti des Chaussettes Dépareillées', 'Alliance des Grasses Matinées', 'Union des Parapluies Retournés',
]);

/* Répliques des adversaires, selon leur sensibilité. En mode Équipes, où
   les camps portent les noms de vrais partis, seules les répliques
   « neutres » sont utilisées : aucun slogan n'est prêté à un vrai parti. */
const SPEECH_LINES = Object.freeze({
  gauche: Object.freeze([
    'Taxons les yachts, pas les baguettes !',
    'Le grand capital a pris toutes les cases !',
    'Mon loyer gagne plus que moi.',
    'Les dividendes ne font pas la vaisselle.',
    'Partageons le gâteau, et la recette !',
    'Un SMIC, deux colocs, trois boulots.',
    'Profits records pour qui, au juste ?',
    'Les inégalités, c\'est comme ma traînée : ça s\'allonge.',
    'Ça ruisselle ? On attend toujours…',
    'Le CAC 40 grimpe, mon frigo descend.',
  ]),
  droite: Object.freeze([
    'Moins d\'impôts, plus de territoire !',
    'Le marché se régule tout seul. Comme mon chat.',
    'Travailler plus pour capturer plus !',
    'La réussite, ça se mérite… et ça se capture.',
    'Baissons les charges, montons les tours !',
    'Premier de cordée, je tire tout le monde !',
    'Mes dividendes créent des emplois, promis.',
    'L\'État, c\'est beaucoup de cases pour rien.',
    'Libérons les énergies… et les ronds-points !',
    'Moi, je ne capture pas : j\'investis.',
  ]),
  neutre: Object.freeze([
    'Votez pour moi, j\'ai des tracts tout chauds !',
    'Promis : des ronds-points pour tous.',
    'Mon programme tient sur un sous-bock.',
    'Je serre des mains, je capture des cases.',
    'Sondage du jour : moi, 100 %.',
    'Une promesse n\'engage que ceux qui la tracent.',
    'Mon slogan ? Euh… « Toujours plus de cases ».',
    'Je suis le candidat du terrain. Littéralement.',
    'Allô ? Ici votre candidat. Je tourne en rond.',
  ]),
  kill: Object.freeze([
    'Rien de personnel, c\'est la démocratie !',
    'Une voix de plus pour moi !',
    'Le débat est clos.',
    'Pas de recours possible !',
    'Bulletin nul !',
  ]),
});

function pickFrom(list, random) {
  return list[Math.floor(random() * list.length)];
}

function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* `count` candidats aux noms de famille tous différents, en évitant ceux de `exclude`. */
function generateCandidates(count, random = Math.random, exclude = []) {
  const takenLastNames = new Set(exclude.map((candidate) => candidate.last));
  const lastNames = shuffled(LAST_NAMES.filter((last) => !takenLastNames.has(last)), random);
  const firstNames = shuffled(FIRST_NAMES, random);
  return lastNames.slice(0, count).map((last, index) => {
    const first = firstNames[index % firstNames.length];
    return { first, last, full: `${first} ${last}` };
  });
}

/* Quelques noms de parti pour un candidat : deux tirés de son nom, un farfelu. */
function generatePartyNames(candidate, count = 3, random = Math.random) {
  const fromName = shuffled(PARTY_PATTERNS, random).map((pattern) => pattern(candidate.first, candidate.last));
  const fancies = shuffled(PARTY_FANCIES, random);
  const names = [...fromName.slice(0, count - 1), fancies[0]];
  return names.slice(0, count);
}

/* Les adversaires d'une campagne. Chacun garde son nom d'un niveau à
   l'autre, et son parti quand les candidats deviennent des partis. Les
   sensibilités sont réparties à parts égales entre gauche et droite, plus
   un candidat neutre quand ils sont en nombre impair. */
function generateRivals(count, random = Math.random, exclude = []) {
  const voices = [];
  for (let i = 0; i < Math.floor(count / 2); i++) voices.push('gauche', 'droite');
  if (count % 2) voices.push('neutre');
  const dealt = shuffled(voices, random);
  return generateCandidates(count, random, exclude).map((candidate, index) => ({
    ...candidate,
    party: pickFrom(PARTY_PATTERNS, random)(candidate.first, candidate.last),   // noms tous différents : partis aussi
    voice: dealt[index],
  }));
}
