Architecture de systèmes de notation et de matchmaking pour jeux de Capture de Drapeau en format 10v10 sans équipes
fixesLa conception d'un système d'évaluation de la compétence des joueurs pour un jeu en format dix contre dix (10v10)
de Capture de Drapeau (CTF) sans équipes fixes représente un défi statistique majeur. Dans ce type d'environnement
multijoueur hautement asymétrique et fluide, la contribution d'un unique individu ne représente théoriquement que 5 %
des variables actives d'une partie. Les modèles de notation traditionnels basés uniquement sur le résultat binaire de la
partie (victoire ou défaite) souffrent d'une lenteur de convergence critique. Il en résulte un effet de dilution du
signal de compétence où les joueurs performants peinent à s'extraire des rangs inférieurs en file d'attente solo, tandis
que des joueurs passifs bénéficient d'une inflation artificielle de leur cote en étant portés ("carried") par des
coéquipiers d'élite.Pour neutraliser ces dérives et garantir la stabilité du classement, un système d'évaluation doit
s'appuyer sur l'analyse de l'historique complet des matchs et sur l'intégration de métriques individuelles objectives
corrélées à l'impact réel sur le drapeau.Analyse comparative des frameworks de notation compétitiveL'analyse des
algorithmes de notation nécessite de confronter leurs fondements mathématiques et leur capacité à s'adapter à des
environnements d'équipes dynamiques à grande échelle.Système de notationDistribution de probabilitéParamètres
fondamentauxMécanisme d'agrégation d'équipeComplexité calculatoireSensibilité structurelle au "carrying"Elo
Classique[cite: 10, 11]Gaussienne (variance fixe)Score scalaire unique ($R$)Somme ou moyenne arithmétique
simple$\mathcal{O}(1)$ (mise à jour instantanée)Critique : Ne distingue aucune contribution individuelle au sein de
l'équipe.Glicko-2[cite: 17, 18]Gaussienne (variance dynamique)Notation ($r$), Écart de classement ($RD$), Volatilité
($\sigma$)Non géré nativement ; nécessite une décomposition en duels$\mathcal{O}(N^2)$ (modèle de duels par
paires)Élevée : Sensible au "volatility farming" et aux asymétries de classement.TrueSkill[cite: 24, 25]Gaussienne
multidimensionnelleCompétence moyenne ($\mu$), Incertitude ($\sigma$)Somme additive linéaire des compétences
individuelles$\mathcal{O}(N)$ (graphe de facteurs bipartite)Élevée : Exploitable par l'association de comptes
volontairement déclassés.Weng-Lin (OpenSkill)[cite: 32, 33]LogistiqueMoyenne de compétence ($\mu$), Écart-type de
l'incertitude ($\sigma$)Prise en charge native d'équipes asymétriques$\mathcal{O}(N)$ (3 à 6 fois plus rapide que
TrueSkill)Modérée : Absence par défaut de pondération des performances en jeu.Whole-History Rating (WHR)[cite: 9,
38]Bradley-Terry temporelForce dynamique ($\gamma$), Incertitude temporelleModélisation globale
rétroactive$\mathcal{O}(M \log M)$ (optimisation globale de l'historique)Faible : Excellente précision historique, mais
inadapté au matchmaking temps réel.Limites mathématiques des systèmes de notation classiques en jeu d'équipeL'adaptation
des systèmes de notation individuels aux jeux en équipe repose historiquement sur des approximations statistiques qui
introduisent d'importantes failles opérationnelles.La défaillance de l'heuristique de duel et de l'additivité simpleDans
le système Elo classique, une méthode courante consiste à décomposer un match d'équipe en une série de duels virtuels
entre chaque joueur de l'équipe A et chaque joueur de l'équipe B. L'équation de mise à jour s'écrit alors comme la somme
des écarts entre les résultats réels et attendus face à chaque adversaire
:$$R'_A = R_A + \sum_{B \in \text{Opponents}} K(S_{AB} - E_{AB})$$

Où $S_{AB} \in \{1, 0.5, 0\}$ représente le résultat du duel virtuel et $E_{AB}$ la probabilité attendue de victoire
calculée par la fonction logistique. Cette approche souffre d'un manque de convergence statistique majeur dans les
formats à grand effectif comme le 10v10, car elle traite les performances individuelles comme des événements
indépendants, ignorant la synergie d'équipe et la répartition des rôles.Dans le framework TrueSkill de première
génération, la performance d'une équipe ($t$) est modélisée de manière déterministe comme la somme des performances
individuelles de ses membres actifs
:$$t_j = \sum_{i \in A_j} p_i \quad \text{où} \quad p_i \sim \mathcal{N}(s_i, \beta^2)$$

La performance d'un joueur ($p_i$) est une variable aléatoire tirée d'une distribution normale centrée sur sa compétence
réelle latente ($s_i$), avec une variance historique de jeu $\beta^2$. Bien que l'utilisation d'un graphe de facteurs
bipartite associé à l'algorithme somme-produit (passage de messages) et à la propagation des attentes (EP) permette de
résoudre efficacement les mises à jour bayésiennes, ce modèle linéaire est structurellement vulnérable aux asymétries de
niveau au sein d'un groupe.Vulnérabilité au "volatility farming" et manipulation des files d'attenteLe système Glicko-2
introduit un paramètre de volatilité ($\sigma$) mesurant le degré d'incohérence des résultats d'un joueur. Cependant, ce
mécanisme est sujet à l'exploitation par "volatility farming". Dans les jeux en équipe sans rosters fixes, un joueur
peut volontairement saboter ses performances ou alterner des phases d'inactivité et de défaites intentionnelles pour
maximiser son écart de classement ($RD$) et sa volatilité.Dès que ces paramètres d'incertitude atteignent leur maximum,
le joueur s'associe à des coéquipiers performants pour enchaîner des victoires. L'algorithme Glicko-2, interprétant ces
victoires inattendues après une phase d'instabilité comme une progression fulgurante, applique des coefficients de
correction disproportionnés, propulsant le joueur porté à un niveau de classement surévalué de plusieurs centaines de
points.Phénoménologie du "carrying" et de l'injection de MMRL'absence de distinction entre les contributions
individuelles lors de la mise à jour des cotes favorise l'apparition de comportements opportunistes qui nuisent à la
représentativité du classement compétitif.Mécanique statistique du surclassement par associationL'exploitation par
surévaluation ("boosting") dans les modèles additifs repose sur l'asymétrie de la mise à jour des compétences lors de
l'association de joueurs de niveaux disparates. Lorsqu'un joueur de très haut niveau s'associe à un joueur de faible
niveau (dont les paramètres $\mu$ et $\sigma$ sont bas et stabilisés), le système évalue la compétence globale du groupe
à un niveau artificiellement bas. La probabilité attendue de victoire face à une équipe moyenne est ainsi sous-estimée
par le matchmaker.Pendant le match, le joueur d'élite compense largement les carences de son coéquipier pour arracher la
victoire. L'écart massif entre le résultat réel et la prédiction probabiliste du système génère une mise à jour positive
importante. Comme le modèle classique répartit la mise à jour de manière symétrique afin de préserver la conservation de
la compétence moyenne, le joueur de faible niveau reçoit une augmentation de sa cote $\mu$ identique ou proportionnelle
à celle du joueur d'élite, alors que son impact réel sur la partie était potentiellement inexistant.Le phénomène
d'injection de MMR en file d'attente duoL'effet d'injection de MMR ("MMR injection") est particulièrement visible dans
les files d'attente solo/duo des formats de champs de bataille cotés. Ce phénomène se produit lorsqu'un joueur à faible
cote (par exemple, 1600 MMR) s'associe à un soigneur ou à un joueur d'élite possédant une cote très élevée (par exemple,
2400 MMR). Le système de matchmaking calcule une valeur moyenne de matchmaking (MMV) pour le salon d'environ 2000.En cas
de victoire dans ce salon de niveau supérieur, le joueur de bas niveau bénéficie d'une correction de cote maximale
(pouvant atteindre +30 points de notation), car le système considère qu'il a battu des adversaires nettement plus forts
que son niveau théorique. En cas de défaite, sa perte de cote est nulle ou insignifiante, car perdre face à des joueurs
mieux classés est statistiquement attendu.Ce déséquilibre permet à un joueur de progresser rapidement vers des rangs
prestigieux tout en maintenant un taux de victoire inférieur à 50 %, détruisant ainsi l'intégrité de la hiérarchie du
classement.Modélisation globale et rétroactive de l'historique des matchsPour pallier les faiblesses des mises à jour
incrémentales, l'utilisation de modèles globaux traitant l'historique complet des compétitions offre des garanties de
précision supérieures.Whole-History Rating (WHR) et processus de WienerLe modèle Whole-History Rating (WHR), conçu par
Rémi Coulom, se distingue des approches incrémentales en évitant les approximations successives après chaque match. WHR
calcule directement le maximum a posteriori (MAP) de l'intégralité de l'historique des parties de l'ensemble des
joueurs. La compétence d'un joueur $i$ à un instant $t$, notée $r_i(t)$, n'est pas modélisée comme une constante, mais
comme une fonction continue du temps variant selon un processus de Wiener (mouvement brownien)
:$$r_i(t_2) - r_i(t_1) \sim \mathcal{N}\left(0, |t_2 - t_1|w^2\right)$$

Où $w^2$ est un paramètre de dynamique temporelle contrôlant la vitesse de variation théorique de la compétence des
joueurs dans le temps. La probabilité de victoire d'un joueur ou d'une équipe face à un opposant à un instant $t$
s'appuie sur le modèle de Bradley-Terry
:$$P(\text{Victoire de } i \text{ contre } j) = \frac{e^{r_i(t)}}{e^{r_i(t)} + e^{r_j(t)}}$$

L'optimisation globale de la vraisemblance de l'historique s'effectue par l'application de la méthode de Newton-Raphson
sur les matrices de covariance temporelle des joueurs. WHR résout nativement le problème statistique des joueurs
"portés" sur le long terme : si un joueur B a joué de nombreuses parties en équipe avec un joueur A d'élite, puis que le
joueur A réalise des matchs en solo contre d'autres adversaires établis, la réévaluation rétroactive de la force réelle
de A va automatiquement ajuster et corriger la force estimée de B, même si ce dernier n'a pas rejoué depuis.TrueSkill
Through Time (TTT)Le modèle TrueSkill Through Time (TTT) applique une philosophie similaire en propageant l'information
statistique à travers un réseau causal unique englobant l'intégralité des événements passés. Contrairement au filtrage
de Kalman classique utilisé en ligne (qui ne propage l'information que vers l'avant), TTT effectue des passes de lissage
bidirectionnelles (forward-backward) sur le graphe de facteurs temporel.Cette modélisation globale garantit une
excellente comparabilité historique des cotes, réduit drastiquement l'incertitude ($\sigma$) dès les premières parties
d'un nouveau joueur et empêche la stabilisation artificielle des cotes à un niveau surévalué en réévaluant constamment
la qualité des opposants passés.Intégration de la performance individuelle et découplage des cotesLa prévention de
l'inflation de cote pour les joueurs portés repose sur l'analyse de signaux individuels mesurables en jeu, permettant
d'ajuster dynamiquement l'attribution des points de compétence.L'évolution de TrueSkill 2TrueSkill 2 introduit une
extension majeure du modèle génératif bayésien en incorporant des informations multidimensionnelles issues du
comportement en jeu. Alors que le modèle classique n'interprète que le résultat binaire du match, TrueSkill 2 modélise
la corrélation statistique entre la compétence latente d'un joueur et des variables de performance mesurables telles que
le ratio d'éliminations et de morts (KDA), le temps de jeu effectif, le comportement d'abandon (quits) et l'appartenance
explicite à une escouade préformée.Le modèle de TrueSkill 2 s'appuie sur des distributions conditionnelles complexes où
les statistiques individuelles sont prédites par le système à partir de la compétence estimée du joueur. Si une équipe
remporte un match mais qu'un joueur présente des statistiques d'activité (éliminations, objectifs) très inférieures aux
prédictions statistiques associées à sa cote supposée, le système attribue la responsabilité de la victoire à ses
coéquipiers performants.Le joueur sous-performant reçoit une fraction minimale de la mise à jour positive de la moyenne
de compétence ($\mu$), évitant ainsi le phénomène d'aspiration vers le haut des joueurs passifs.L'architecture à double
cote : Encounter MMR vs Win/Loss MMRPour concilier la valorisation des objectifs d'équipe et la détection fine des
compétences individuelles, certains systèmes de matchmaking modernes séparent la cote cachée du joueur en deux
indicateurs distincts :L'Encounter MMR (Cote de Confrontation) : Évalue la capacité intrinsèque d'un joueur à remporter
ses duels physiques directs en jeu. Elle est calculée en analysant les duels face à des adversaires spécifiques,
l'efficacité des dégâts infligés, l'assistance active et la précision de l'utilisation des compétences.Le Win/Loss MMR
(Cote de Résultat) : Se concentre exclusivement sur l'issue finale du match (victoire ou défaite) et la force relative
de l'équipe adverse.Ce système applique une pondération dynamique de ces deux cotes selon le niveau global du salon de
matchmaking.[Niveaux Bronze à Or] =======> Priorité à l'Encounter MMR (Extraction rapide des smurfs / combat individuel)
[Niveaux Platine à GC] =======> Priorité au Win/Loss MMR (Valorisation exclusive du jeu d'équipe et des objectifs) Dans
les rangs inférieurs (Bronze à Or), le système accorde une importance majeure à l'Encounter MMR afin de propulser
rapidement les joueurs performants vers leur véritable rang de compétence, quel que soit le niveau de leurs coéquipiers
d'un match.À l'inverse, dans les rangs de haut niveau (Platine à Supersonic Legend), le Win/Loss MMR devient le facteur
prédominant pour valoriser la prise de décision stratégique et le jeu d'équipe au détriment des statistiques de combat
pures.Le calcul des affrontements individuels au sein de l'Encounter MMR repose sur une évaluation asymétrique des
duels. Éliminer un adversaire possédant une cote supérieure confère un gain significatif d'Encounter MMR, tandis qu'être
éliminé par un joueur moins bien classé inflige une pénalité sévère, empêchant ainsi le portage passif par de meilleurs
coéquipiers lors des combats de groupe.Spécification d'un modèle hybride pour la Capture de Drapeau en format 10v10La
transposition de ces modèles à un mode Capture de Drapeau en 10v10 nécessite de définir des indicateurs de performance
objectifs qui ne valorisent pas uniquement le combat physique (KDA), afin de prévenir les dérives de jeu où les
participants délaissent les objectifs de drapeau pour préserver leurs statistiques individuelles.Formulation de l'Indice
de Performance Objective (CFPM)L'évaluation de la contribution individuelle au sein d'un match de Capture de Drapeau
s'organise autour du calcul d'un indicateur de performance globale, appelé Capture the Flag Performance Metric ($CFPM$)
:$$CFPM_i = w_{\text{cap}} \cdot C_i + w_{\text{ret}} \cdot R_i + w_{\text{grab}} \cdot G_i + w_{\text{def}} \cdot D_i + w_{\text{combat}} \cdot K_i$$

Chaque variable de l'équation correspond à une action mesurable sur le terrain de jeu :$C_i$ : Nombre de captures de
drapeaux finalisées par le joueur (action de ramener le drapeau adverse à la base de son équipe).$R_i$ : Nombre de
récupérations de drapeau (action d'éliminer le porteur adverse ou de sécuriser un drapeau allié au sol pour le renvoyer
à la base).$G_i$ : Nombre de saisies de drapeau ("flag grabs") au sein de la base ennemie.$D_i$ : Temps de présence
active en zone défensive (rayon de protection de la base ou escorte rapprochée de son propre porteur de drapeau).$K_i$ :
Score de combat ajusté, évaluant l'efficacité des duels physiques et éliminations de joueurs adverses à proximité
immédiate des objectifs.Les coefficients de pondération théoriques doivent être calibrés afin de valoriser équitablement
les rôles de combat et les rôles de soutien logistique ou défensif.Intégration de la contribution dynamique dans le
modèle Weng-LinLe framework Weng-Lin (OpenSkill) offre d'excellentes performances de calcul en ligne pour des lobbies de
grande taille comme les formats 10v10, tout en permettant l'intégration de pondérations individuelles. Une fois le match
terminé, la contribution relative de chaque joueur au sein de son équipe est calculée par le rapport entre son indice
individuel et l'indice moyen de son équipe :$$\theta_i = \frac{CFPM_i}{\frac{1}{N} \sum_{j=1}^N CFPM_j}$$

Où $N = 10$ représente le nombre de joueurs dans l'équipe. Cette valeur $\theta_i$ sert de modificateur dynamique à la
mise à jour de la cote de compétence calculée par l'algorithme. Lors d'une victoire, la mise à jour de la moyenne de
compétence de chaque joueur $i$ s'écrit :$$\mu'_i = \mu_i + \theta_i \cdot \Delta \mu_{\text{base}}$$

Où $\Delta \mu_{\text{base}}$ est la variation de compétence brute attribuée à une équipe de niveau moyen par
l'algorithme de Weng-Lin face à l'adversaire rencontré.Si un joueur passif se fait entièrement porter par ses
coéquipiers sans réaliser d'actions objectives ni remporter de duels, son indice $CFPM_i$ tend vers zéro, réduisant sa
contribution relative $\theta_i$ à une valeur infinitésimale. Sa cote de compétence $\mu_i$ reste ainsi inchangée malgré
la victoire de son équipe, bloquant net l'inflation statistique de sa notation.Les points de compétence non attribués au
joueur passif sont mathématiquement redistribués aux joueurs ayant effectivement porté l'équipe vers l'objectif,
récompensant ainsi l'impact individuel réel.Paramètres et configuration opérationnelle du système proposéLe tableau
suivant présente la configuration des paramètres fondamentaux et des coefficients de pondération du système de notation
hybride spécifié pour un jeu de Capture de Drapeau en format 10v10.Paramètre ou CoefficientSymbole mathématiqueValeur
nominale recommandéeJustification technique et rôle dans la stabilité du matchmakingMoyenne initiale de compétence[cite:
56]$\text{MU}$ ($\mu_0$)$25.0$Point de départ de la compétence des nouveaux joueurs sur une courbe
gaussienne.Incertitude initiale[cite: 56]$\text{SIGMA}$ ($\sigma_0$)$8.333$Écart-type maximal modélisant l'absence
d'information historique sur le joueur.Largeur de classe de compétence[cite: 56]$\text{BETA}$ ($\beta$)$4.167$Distance
en points garantissant statistiquement une probabilité de victoire de 76 % face à l'adversaire.Facteur de dynamique
temporelle[cite: 56]$\text{TAU}$ ($\tau$)$0.083$Ajout additif systématique à la variance pour empêcher la convergence de
$\sigma$ vers $0$.Poids de capture de drapeau[cite: 5]$w_{\text{cap}}$ $5.0$Récompense l'action critique finale de
victoire de manche.Poids de retour de drapeau[cite: 5]$w_{\text{ret}}$ $3.5$Valorise l'interception et le nettoyage de
la base pour libérer le drapeau allié.Poids de saisie du drapeau[cite: 55]$w_{\text{grab}}$ $1.5$Récompense
l'infiltration de la base ennemie et la création d'opportunités.Poids de défense de zone[cite: 5]$w_{\text{def}}$ $0.1$
/ secondeValorise le contrôle territorial passif et la protection de la zone de retour.Poids de combat de
proximité[cite: 54]$w_{\text{combat}}$ $1.0$ (combat de zone)Récompense la sécurisation physique de la route du porteur
de drapeau.Synthèse des recommandations opérationnelles pour le matchmakingL'intégration de cette architecture au sein
d'un moteur de matchmaking exige de concilier la précision de l'évaluation avec des contraintes d'attente acceptables
pour les joueurs.Gestion du compromis entre qualité de match et temps d'attenteLe matchmaking pour des équipes de dix
joueurs sans rosters prédéfinis implique de gérer une forte variance de compétences au sein d'un même salon.
L'algorithme doit appliquer une recherche par couches d'incertitude. Initialement, le système tente de regrouper vingt
joueurs dont la différence de cotes est inférieure à un écart-type de compétence :$$|\mu_A - \mu_B| < \beta$$

Si le temps d'attente en file d'attente dépasse soixante secondes, le matchmaker élargit progressivement ses critères
d'acceptation en acceptant des joueurs d'incertitudes ($\sigma$) plus élevées ou des écarts de moyennes supérieurs, tout
en veillant à équilibrer la moyenne arithmétique globale des deux équipes pour préserver une probabilité de victoire
proche de 50 %.Restrictions de file d'attente asymétriques pour les groupesPour éliminer l'exploitation par "MMR
injection" en file d'attente compétitive, le système doit appliquer des règles de groupe strictes. Les joueurs formants
un groupe (duo ou trio) ne peuvent rejoindre la file d'attente ensemble que si leur écart de niveau est inférieur à une
limite prédéfinie :$$|\mu_{\text{Joueur 1}} - \mu_{\text{Joueur 2}}| < 1.5 \cdot \beta$$

De plus, l'avantage de coordination d'un groupe préformé doit être compensé lors du matchmaking par l'application d'un
facteur de correction d'escouade sur la cote moyenne estimée du groupe. Si un groupe de deux joueurs à 1500 de cote
s'enregistre, le matchmaker évalue virtuellement leur force combinée à 1650 lors de la recherche d'adversaires, forçant
ces derniers à affronter des joueurs individuellement plus forts ou d'autres groupes coordonnés pour équilibrer la
partie.Découplage de la file d'attente amicale et compétitiveIl est recommandé de maintenir des profils de notation
strictement indépendants entre les files d'attente de jeu amicales et compétitives. Cette séparation protège les joueurs
lors de phases d'expérimentation de nouvelles stratégies ou d'un style de jeu moins compétitif, évitant ainsi que des
contre-performances en mode amical n'altèrent l'intégrité de leur classement en mode compétitif principal.Affichage
d'une cote de classement conservatriceAfin de prévenir l'anxiété liée à la perte immédiate de points et de décourager
les joueurs de "protéger" artificiellement leur classement en cessant de jouer après une série de victoires, le système
doit afficher un score de classement visible calculé de manière conservatrice :$$\text{Score visible} = \mu - 3\sigma$$

Au début de sa phase de calibrage, un joueur possède une incertitude $\sigma$ maximale, affichant ainsi un classement
visible volontairement bas, proche de zéro. Au fil des parties jouées, l'accumulation de données permet de réduire
l'incertitude $\sigma$.Cette réduction progressive de l'écart-type fait monter naturellement le score visible du joueur
vers sa moyenne réelle $\mu$, offrant une sensation de progression constante et fluide, tout en garantissant qu'un
joueur avec peu de matchs ne puisse pas occuper durablement le sommet du classement par simple chance statistique.
