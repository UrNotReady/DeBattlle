# DeBattle — prototype

> **Jeu parodique.** DeBattle n'est ni lié aux partis cités (LFI, Renaissance, RN), ni soutenu par eux ; tous les autres noms sont inventés. Aucun logo de parti, aucun responsable politique réel, aucun slogan prêté à un vrai parti. La mention figure aussi sur l'accueil du jeu.

Jeu de conquête de territoire pour navigateur, inspiré de Paper.io (anciennement « Politique Papers »), sur le thème (très) libre d'une campagne électorale. HTML, CSS et JavaScript natifs, sans serveur.

Tu pars d'un petit territoire. Tu en sors en traçant une ligne, tu reviens chez toi, et tout ce que la ligne entoure devient à toi. Tant que tu es dehors, ta ligne est vulnérable : si un adversaire la touche, tu perds. Chaque case est une voix : le premier camp à posséder 51 % de l'arène l'emporte.

## Modes de jeu

### Crée ton parti (solo, 5 niveaux)

Une campagne en cinq niveaux, chacun une mêlée générale où il faut remporter 51 % de l'arène :

| Niveau | Arène | Découpage | Adversaires |
| --- | --- | --- | --- |
| 1. Quartier | disque de 42 unités | 5 secteurs | 3 candidats |
| 2. Ville | disque de 56 unités | 6 quartiers | 4 partis |
| 3. Département | disque de 70 unités | 7 communes | 5 partis |
| 4. Région | disque de 84 unités | 9 départements | 5 partis |
| 5. Élection finale | France, 116 unités | 12 régions | 5 partis |

- Comme en équipes, chaque arène est découpée en zones : un camp qui en possède plus de 70 % reçoit le reste d'un coup (« Commune conquise : Saint-Bulletin ! »). Une zone au centre, les autres en parts aux limites ondulées ; le découpage et les noms (inventés) sont les mêmes à chaque partie d'un niveau. La ligne sous le score dit dans quelle zone tu es et ce que tu en tiens ; le classement compte les zones tenues en entier.

- Au départ, tu choisis un nom de candidat parmi trois propositions (bouton « Autres idées » pour en tirer d'autres), ou tu écris le tien.
- En arrivant à la ville, tu fondes ton parti : trois noms proposés, tirés de ton nom ou farfelus, ou le tien.
- Ta couleur est au choix parmi huit (jaune soleil par défaut) ; les adversaires prennent les autres, aucune n'est partagée.
- Tes adversaires sont des candidats générés ; à partir de la ville, ils deviennent eux aussi des partis, dont le nom vient du leur. Ils restent les mêmes d'un niveau à l'autre.
- Niveau gagné : on passe au suivant.
- Trois difficultés, au choix sur la carte de l'accueil (choix gardé dans le navigateur) :

| Difficulté | Quand tu es éliminé | Adversaires | Finale |
| --- | --- | --- | --- |
| Normal | tu réapparais 3 s plus tard dans la même partie, qui continue jusqu'à ce que quelqu'un atteigne 51 % | comme indiqué ci-dessus | oui |
| Chaud | la partie s'arrête ; tu reprends le niveau en cours | comme indiqué ci-dessus | oui |
| Hardcore | la partie s'arrête ; retour au quartier (ton nom et ton parti restent) | deux de plus à chaque niveau | non |

- Finale : en Normal et en Chaud, si tu perds en étant dans les deux premiers avec au moins un tiers de l'arène, une finale à deux t'oppose au premier (ou au deuxième si c'est toi le premier). Elle se joue à chaque niveau ; la gagner fait passer au niveau suivant, la perdre fait reprendre le niveau.
- La campagne est gardée dans le navigateur : on peut la reprendre plus tard depuis l'accueil (« Continuer »), ou en commencer une nouvelle.
- Tous les noms sont inventés (« Josiane Bulletin », « Parti de la Sieste »…) : aucun nom de personne ou de parti réels.

### Équipes (3 camps, 2 tours)

- Trois camps de trois joueurs, LFI, Renaissance et RN, sur la carte de France (inscrite dans un carré de 101 unités). Tu choisis ton camp et joues avec deux alliés IA.
- Le territoire est commun à l'équipe ; la ligne d'un allié ne te fait rien.
- **Premier tour** : un camp à 51 % est élu d'office. Si tu es éliminé avant, on compte : si ton camp est strictement en tête **et** possède au moins un tiers du pays (33,3 %), tu passes au second tour, face au camp arrivé deuxième. Sinon, c'est perdu.
- **Second tour** : carte neuve, deux camps de trois. Il se gagne à 51 % ; si tu y es éliminé, le camp en tête au décompte l'emporte (égalité : tu perds).
- Renforts : chaque capture peut faire venir un nouveau joueur IA dans l'équipe, d'autant plus probablement que la zone gagnée est vaste. Neuf joueurs par camp au plus.
- Les joueurs IA portent des noms de rôles (Militant, Bénévole, Députée…), les mêmes pour les trois camps.
- Les trois camps suivent exactement les mêmes règles, avec la même IA ; seuls le nom et la couleur changent.
- Couleurs approchées, sans logo : rouge à tranche violette pour LFI, bleu marine pour le RN, jaune pour Renaissance (son bleu marine se confondrait avec celui du RN).

### En ligne (équipes, jusqu'à 6 humains)

Pour jouer avec des copains, à côté ou à distance, sans serveur à nous :

1. **Créer une partie** : l'appareil de l'hôte ouvre un salon et affiche un code de 4 lettres (ex. `KRBX`). « Partager le lien » ouvre le partage du téléphone (ou copie le lien) : `…#rejoindre=KRBX`.
2. **Rejoindre** : les copains ouvrent le lien (le code est déjà rempli) ou tapent le code, puis leur nom.
3. **Salon** : chacun choisit son nom et son camp (trois humains par camp au plus, six en tout) ; l'hôte lance la partie. Les places libres sont tenues par des IA.
4. **Partie** : mêmes règles qu'en équipes, sur la carte de France, avec renforts et régions. Tout le monde réapparaît 3 s après une élimination ; la partie dure jusqu'à ce qu'un camp atteigne 51 %. Chacun voit ensuite si son camp a gagné, et l'on revient au salon pour la suivante.

Fonctionnement :

- L'hôte fait tourner la partie ; vingt fois par seconde, il envoie à chaque invité ce qui a changé (cases, têtes, traînées, événements), environ 1 Ko par message, soit une vingtaine de Ko/s par invité. Les invités affichent une copie de la partie, où les têtes glissent en douceur entre deux messages, et envoient seulement leurs commandes (direction, compétences, dash visé).
- La connexion est directe entre appareils (WebRTC), via la bibliothèque PeerJS, copiée dans `vendor/` (licence MIT). Seule la mise en relation passe par le service gratuit de PeerJS (`0.peerjs.com`), qui fournit aussi un relais pour les réseaux qui bloquent la connexion directe. Pour utiliser un autre serveur : `CONFIG.online.server` dans `js/config.js`.
- En partie, la pause ne fige rien (la partie continue pour les autres) ; elle donne accès aux options et à « Quitter la partie ». L'écran reste allumé pendant la partie quand le navigateur le permet.
- Un invité qui part (ou ne donne plus signe de vie pendant 15 s) est remplacé par une IA. Si l'hôte part, tout le monde revient à l'accueil.
- La traînée protégée ne s'applique pas en ligne, et les parties en ligne ne comptent pas pour les records.
- **L'hôte doit garder le jeu ouvert et au premier plan** : c'est son appareil qui fait tourner la partie.

### Options

Bouton « Options » sur l'accueil et dans la pause ; les choix sont gardés dans le navigateur et s'appliquent tout de suite, même à la partie en pause.

- **Contrôles auto** (par défaut) : le cube avance tout seul, on le dirige. Pour s'arrêter : double tap sur mobile, double clic ou F sur ordinateur ; il repart à la prochaine direction donnée.
- **Contrôles manuels** : le cube n'avance que tant qu'on le dirige — flèches ou ZQSD maintenues, clic gauche maintenu (il va vers la souris), ou pouce posé sur l'écran. Tout relâcher l'arrête.
- **Traînée vulnérable** (par défaut) : règle normale. **Traînée protégée** : personne ne peut couper ta ligne, toi compris (adversaire, bombe, recoupe). Une partie jouée, même un moment, traînée protégée ne compte pas pour les records ; un badge le rappelle en jeu.

## Bulles de dialogue

Les adversaires lancent de temps en temps une réplique dans une bulle (toutes les 16 à 32 secondes chacun, deux bulles au plus à l'écran, sur un fond légèrement transparent pour ne pas cacher le jeu), et se réjouissent quand ils éliminent quelqu'un.

- En campagne, chaque adversaire a une sensibilité : certains dénoncent les inégalités et le grand capital (« Taxons les yachts, pas les baguettes ! »), d'autres défendent le marché (« Le marché se régule tout seul. Comme mon chat. »), d'autres font simplement campagne. Les sensibilités sont réparties à parts égales entre les deux bords.
- En équipes, les camps portant les noms de vrais partis, ils ne disent que des répliques neutres : aucun slogan n'est prêté à un vrai parti.
- Toutes les répliques sont dans `js/names.js`.

## Lancer le jeu

Aucune installation, aucun serveur.

- **En local** : ouvrir `index.html` dans un navigateur récent.
- **En ligne** : déposer le dossier tel quel sur un hébergement statique (GitHub Pages : pousser les fichiers à la racine du dépôt, puis activer Pages dans Settings > Pages, branche `main`, dossier `/ (root)`). Le jeu en ligne demande une adresse en https, ce que fournit GitHub Pages.
- La police Fredoka est chargée depuis Google Fonts ; hors ligne, le jeu utilise une police du système.

## Contrôles

| Support | Commande |
| --- | --- |
| Ordinateur | Flèches ou ZQSD (WASD en QWERTY : mêmes touches physiques). Deux touches ensemble donnent la diagonale. |
| Ordinateur | En partie : Espace = boost, R = bombe. E maintenu = viser le dash (les flèches ou ZQSD orientent la flèche), E relâché = le lancer. F ou double clic : s'arrêter (contrôle auto). Échap ou P : pause. Entrée : continuer la campagne, ou bouton principal de l'écran de fin. |
| Ordinateur | Contrôle manuel : clic gauche maintenu, le cube va vers la souris. |
| Ordinateur | Molette : zoom. Maj + molette : inclinaison. Clic droit glissé : rotation (gauche-droite) et inclinaison (haut-bas) de la caméra. |
| Mobile | Glisser le pouce n'importe où : le cube prend la direction du geste. En contrôle auto, deux taps rapides l'arrêtent ; en manuel, lever le pouce l'arrête. |
| Mobile | Deux doigts : pincer pour zoomer, glisser ensemble vers le haut ou le bas pour incliner, tourner pour faire pivoter la caméra. |
| Mobile | Compétences : trois icônes rondes sur le bord droit. Dash : appuyer sur son bouton, glisser le doigt pour orienter la flèche autour du cube, lâcher pour foncer. Pause : bouton rond en haut à gauche, sous le score. |
| Tous | Quand la caméra ne regarde plus vers le nord, une boussole apparaît au coin de la mini-carte ; la toucher ramène la caméra. |

Les commandes sont relatives à la vue : « haut de l'écran » veut dire « devant la caméra ». Le cube reste immobile jusqu'à la première commande ; il rejoint le cap demandé en tournant progressivement (à l'arrêt, il repart directement dans la bonne direction).

## Règles en place

**Jeu**

- Déplacement libre, virages courbes. Les bords de l'arène arrêtent la tête sans la tuer ; une boucle fermée contre un bord capture ce qu'elle entoure.
- Plus le territoire est grand, plus on est lent : 1 % de vitesse en moins par pour cent d'arène possédé, jusqu'à 40 %.
- Zones : sur la carte de France, douze régions ; en campagne, des secteurs, quartiers, communes ou départements. Un camp qui possède plus de 70 % d'une zone en reçoit le reste d'un coup.
- Score : surface possédée. Pourcentage : part de l'arène. Records : la meilleure part, par niveau de campagne et en équipes, gardée dans le navigateur.

**Éliminations et compétences**

Chaque adversaire éliminé compte (tête de mort) et rapporte une charge, dix au plus.

| Compétence | Coût | Effet |
| --- | --- | --- |
| Boost | 1 | Vitesse × 1,6 pendant 2,5 s, cumulable. |
| Dash | 3 | Se vise bouton (ou E) enfoncé : une flèche autour du cube montre la direction et jusqu'où il ira ; part au relâchement, même à l'arrêt. Plus explosif avec les éliminations : vitesse × (3 + 0,25 par élimination) pendant 0,3 s + 0,02 s par élimination, soit environ 11 unités à 3 éliminations et 22 à 10 (plafond). En plein dash, on traverse les têtes adverses sans choc frontal ; la traînée et les coupes restent les mêmes. Onde de choc et gerbe d'éclats d'autant plus grandes que le dash est puissant. |
| Bombe | 10 | Lancée à 9 unités : grande éclaboussure qui devient ton territoire et élimine les adversaires touchés, eux ou leur traînée. |

**Pause** (bouton rond à côté du badge, ou Échap / P) : la partie se fige. Depuis la pause :

- en campagne : changer de nom (le candidat, ou le parti une fois fondé), changer de couleur (tout de suite, dans la partie et pour la suite), changer de difficulté (le niveau recommence), passer en équipes ;
- en équipes : changer de camp (nouveau premier tour), ou passer à la campagne ;
- revenir au menu principal ; la campagne reste gardée au niveau en cours.

**Causes de défaite** : un autre camp atteint 51 % ; un adversaire touche ta traînée ; tu recoupes ta propre traînée ; choc frontal hors de ton territoire ; ton territoire est entièrement conquis ; une bombe adverse (prévue par les règles, l'IA n'en lance pas).

## Interface

- Têtes en blocs aux arêtes arrondies (coins et bord du dessus). Elles flottent : en entrant dans un territoire, elles s'y enfoncent (la partie immergée prend la couleur de la zone, sous une ligne de flottaison claire) puis remontent doucement à la surface en oscillant un peu ; en sortant, elles retombent vite sur la banquise avec un petit rebond. Leur ombre reste au sol.
- Territoires en blocs aux bords bombés : sous le dessus, trois paliers suivent un quart de cercle, tous du même dégradé que le dessus (seul l'anneau extérieur est très légèrement ombré) ; les flancs et les ombres tirent vers un brun chaud plutôt que vers le noir.
- Style « jeu de plateau » : panneaux crème, rubans de titre, gros boutons ronds qui se soulèvent et s'enfoncent, police ronde.
- Logo DeBattle dessiné en HTML et CSS (aucune image) : « De » blanc et « Battle » jaune, en italique cerné d'encre, sur une plaque coupée net entre le rouge et le bleu, avec une couronne et un éclat.
- Accueil : les trois modes (campagne, équipes, en ligne) décrits sur des cartes (deux colonnes sur grand écran), sélecteur Normal / Chaud / Hardcore avec une phrase qui explique la difficulté choisie, progression de la campagne en cinq étapes, bouton « Options » avec le rappel des options en cours, aide des commandes repliable.
- En partie : part d'arène, score, record, éliminations, bouton pause, badge du niveau ou du tour (« 3/5 · Département · Normal »), région en cours (France), classement (ta ligne cerclée de blanc, régions complètes), mini-carte, boussole, compétences (anneau de progression, petit bond quand une compétence devient disponible).
- Annonces sur ruban : début de niveau, région complétée, second tour, réapparition en Normal et en ligne (« Tombé·e ! Retour dans 3 s »).
- Écran de fin : titre sur ruban vert (gagné, qualifié) ou rouge (battu), étapes de la campagne, message souvent drôle, résultats façon soirée électorale, score, éliminations, record, bouton principal adapté (« Niveau suivant », « Reprendre : Ville », « Jouer la finale », « Recommencer : Quartier », « Second tour », « Rejouer », « Nouvelle campagne »).

## Structure des fichiers

```
index.html            Structure de la page et ordre de chargement des scripts
vendor/peerjs.min.js  PeerJS 1.5.5 (connexions WebRTC), licence dans vendor/PEERJS-LICENSE
css/style.css         Interface : accueil, choix des noms, affichage en partie, fin de partie
js/config.js          Réglages, palette, équipes, niveaux de la campagne, sortes de zones
js/names.js           Noms de candidats et de partis générés, répliques des adversaires
js/maps.js            Formes d'arène : disque découpé en zones, contour et régions de la France, carré
js/grid.js            Grille fine : propriété des cases, capture par remplissage, apparitions
js/ai.js              Décisions des adversaires
js/game.js            Règles : camps, déplacements, traînées, collisions, éliminations, renforts, décompte
js/abilities.js       Compétences : charges, boost, dash visé, bombe
js/speech.js          Quand et quoi disent les adversaires
js/contour.js         Contour lisse des territoires
js/terrain.js         Relief du terrain
js/ground.js          Texture du sol
js/projection.js      Caméra en perspective : zoom, inclinaison, rotation
js/render.js          Rendu Canvas 3D : décor, territoires, traînées, cubes, effets, textes, bulles
js/minimap.js         Mini-carte
js/input.js           Clavier, tactile, souris
js/ui.js              Écrans, affichage en partie, textes
js/online.js          En ligne : salon, messages de l'hôte (différences), copie de la partie chez l'invité
js/net.js             En ligne : connexion PeerJS, codes de partie, messages d'erreur
js/main.js            Boucle de jeu, campagne, sauvegarde
tests/logic-test.js   Tests des règles, hors navigateur
```

`config.js`, `names.js`, `maps.js`, `grid.js`, `ai.js`, `game.js`, `abilities.js`, `speech.js`, `online.js` et `projection.js` ne touchent jamais au DOM.

## Tests

```
node tests/logic-test.js
```

Les 62 tests couvrent notamment : le jeu en ligne (humains d'abord dans leur camp, IA pour compléter, seuls les humains attendent une commande, réapparition de tous, fin à 51 % avec le camp gagnant, invité remplacé par une IA, copie de l'invité identique à la partie de l'hôte après dix secondes de jeu avec dash et bombe, différences de cases en suites compactes, salon : six humains, trois par camp, noms nettoyés), l'arrêt (sur place, puis départ immédiat dans la direction donnée), le dash (coût, direction visée, même à l'arrêt, longueur selon les éliminations, plafond, sans choc frontal), la traînée protégée (ni recoupe ni coupe adverse, hors records), le découpage en zones de chaque niveau (nombre, noms, chaque case dans une zone, tailles équilibrées, même carte à chaque partie) et la capture d'un secteur à 70 %, la couleur au choix (jamais partagée, changeable en cours de partie), les trois difficultés (réapparition, fin de partie, adversaires en plus) et la finale de campagne (duo de tête, seuil d'un tiers, jamais en Hardcore), la campagne (cinq niveaux de plus en plus vastes, candidats puis partis), les noms générés (tous différents, sensibilités équilibrées), les répliques (jamais plus de deux à la fois, neutres en équipes), le second tour (seuil d'un tiers, qualification, décompte), la caméra tournée, la carte de France et ses régions, la victoire à 51 %, les compétences, les collisions et les captures, et dix minutes de partie simulée en solo comme en équipes.

Vérifié aussi dans Chrome sans interface (dont une partie en ligne complète : un hôte sur ordinateur, un invité sur téléphone par le lien, un invité au clavier par le code après un mauvais code, choix des camps, commandes et dash des invités, cases identiques chez l'hôte et l'invité, pause qui ne fige pas, invité parti remplacé par une IA, fin de partie vue de chaque camp, retour au salon, départ de l'hôte, messages d'erreur sans réseau) (téléphone 390 × 844 en portrait et en paysage, ordinateur 1280 × 800) : accueil, choix du candidat, niveau gagné, choix du parti, niveau perdu puis repris, réapparition en Normal, finale gagnée, défaite en Hardcore et retour au quartier, difficulté retrouvée après rechargement, options (contrôle auto : double tap et double clic arrêtent ; manuel : arrêt au relâchement des touches, du clic et du doigt, cube dirigé vers la souris ; dash visé au doigt et au clavier ; traînée protégée ; options gardées après rechargement et changées depuis la pause), pause (partie figée, nom écrit ou proposé, couleur, difficulté, passage en équipes et retour, changement de camp, Échap), classement lisible sur 360 px, qualification et second tour en équipes, bulles de dialogue, sans erreur. **Pas encore essayé sur un vrai téléphone, ni dans Safari ou Firefox.**

## Ce qui manque encore

- En ligne : pas encore de QR code, pas de reprise après une coupure (un invité coupé revient par le salon de la partie suivante), pas de mode solo en ligne. Essayé avec un serveur PeerJS local et plusieurs Chrome sur la même machine, **pas encore entre de vrais téléphones ni à travers des réseaux mobiles**. Dans l'aperçu de claude.ai, le jeu en ligne peut être bloqué : pour jouer avec des copains, héberger le dossier (GitHub Pages par exemple).
- Compétences pour l'IA ; l'IA elle-même ne change pas d'une difficulté à l'autre.
- Équilibrage : tailles des niveaux, coûts des compétences, ralentissement et renforts sont des premières valeurs, réglables dans `js/config.js`.
- Son.
- La 3D est dessinée en Canvas 2D, sans WebGL : sol plat (le relief n'est qu'un éclairage).
- La Corse et les îles ne sont pas représentées.
