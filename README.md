# PRODMONDE
### Cartographie interactive de l'évolution mondiale des grandes cultures (1961–2024)

> Application web de visualisation interactive analysant la production agricole mondiale 
> (blé, riz, maïs, soja, canne à sucre, orge, pommes de terre, palmier à huile, ignames) 
> entre 1961 et 2024, à partir des données FAOSTAT.

| 🚀 Démo | 📓 Observable | 📊 Données | 📄 Rapport |
|---|---|---|---|
| [bamisholaloke.com/prodmonde/](https://bamisholaloke.com/prodmonde/) | [Notebook](https://observablehq.com/d/8eb132f2244bd233) | [FAOSTAT QCL](https://www.fao.org/faostat/en/#data/QCL) | [rapport_visu_PRODMONDE.pdf](./rapport_visu_PRODMONDE.pdf) |

---

## 📸 Aperçu

![Dashboard PRODMONDE](data/demo_carte.png)

---

## 🎯 Fonctionnalités

- **Carte choroplèthe mondiale** — encodage par production, surface récoltée ou rendement, avec animation temporelle (Play/Reset) et zoom interactif
- **Classements Top Pays / Top Continents** — bar charts synchronisés en temps réel
- **Scatter plot d'intensification agricole** — surface vs rendement (log), taille des bulles = production
- **Comparaison temporelle multi-pays** — sélection de plusieurs pays simultanément sur la période 1961–2024
- **Page Détails pays** — KPI cards + bar chart par culture + line chart multi-cultures
- **Page Statistiques** — donuts par culture/continent + area chart empilé des parts de marché

---

## 🗂️ Structure du projet
```
prodmonde/
├── index.html                          # Application principale
├── main.js                             # Visualisations D3.js (~2000 lignes)
├── styles.css                          # Styles
├── rapport_visu_PRODMONDE.pdf          # Rapport du projet
├── data/
│   ├── main2.py                        # Script Python de prétraitement
│   ├── my_faostat_subset_long.csv      # Dataset final (format long, 217 389 lignes)
│   └── Production_Crops_Livestock_E_All_Data/
│       └── ...                         # Fichiers sources FAOSTAT
```

---

## 🔧 Stack technique

- **Visualisation** : D3.js v7
- **Cartographie** : TopoJSON + Natural Earth
- **Données** : FAOSTAT – table QCL (téléchargée janvier 2025)
- **Prétraitement** : Python / pandas (`data/main2.py`)
- **Déploiement** : GitHub Pages + domaine personnalisé

---

## 📦 Données

Le fichier `my_faostat_subset_long.csv` est le seul fichier chargé par l'application.  
Il est produit par `data/main2.py` à partir du fichier brut FAOSTAT et contient :

| Dimension | Valeur |
|---|---|
| Nombre de lignes | 217 389 |
| Cultures | 9 (Barley, Maize, Oil palm fruit, Potatoes, Rice, Soya beans, Sugar cane, Wheat, Yams) |
| Indicateurs | 3 (Surface récoltée, Rendement, Production) |
| Zones géographiques | 237 |
| Période | 1961 – 2024 |

---

## ⚠️ Limites connues

- Données 2024 partielles pour certains pays
- Correspondance noms FAOSTAT / TopoJSON via dictionnaire manuel
- Dataset chargé intégralement côté client (temps de chargement variable)

---

## 📝 Crédits

| Ressource | Source |
|---|---|
| Données agricoles | FAOSTAT – QCL, FAO/Nations Unies |
| Géographie | Natural Earth via TopoJSON World Atlas |
| Visualisation | D3.js v7 – Mike Bostock |
| Cartographie | TopoJSON – Mike Bostock |
| Exploration | Observable Plot |

Projet réalisé dans le cadre du cours **MOS 9.1 – Visualisation Interactive de Données**  
École Centrale Lyon, 2025-2026  
**Encadrants :** Romain Vuillemot, Théo Jaunet, Romuald Thion