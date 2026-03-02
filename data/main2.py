import pandas as pd
from pathlib import Path

# ---------- CONFIG ----------
INPUT = Path("data/Production_Crops_Livestock_E_All_Data/Production_Crops_Livestock_E_All_Data_NOFLAG.csv")
OUTPUT = Path("data/my_faostat_subset_long.csv")

# Tes 9 cultures
KEEP_ITEMS = {
    "Barley",
    "Maize (corn)",
    "Oil palm fruit",
    "Potatoes",
    "Rice",
    "Soya beans",
    "Sugar cane",
    "Wheat",
    "Yams",
}

# Tes 3 éléments
KEEP_ELEMENTS = {"Area harvested", "Yield", "Production"}

# Période complète du dataset FAOSTAT
YEAR_START = 1961
YEAR_END = 2024

CHUNKSIZE = 50_000

# Colonnes "id" à garder
ID_COLS = [
    "Area Code",
    "Area Code (M49)",
    "Area",
    "Item Code",
    "Item Code (CPC)",
    "Item",
    "Element Code",
    "Element",
    "Unit",
]

def year_cols_in_range(columns):
    """Retourne les colonnes du type Y1961..Y2024 dans l'intervalle demandé."""
    cols = []
    for y in range(YEAR_START, YEAR_END + 1):
        c = f"Y{y}"
        if c in columns:
            cols.append(c)
    return cols

def main():
    if not INPUT.exists():
        raise FileNotFoundError(f"Fichier introuvable: {INPUT.resolve()}")

    # Lire l'en-tête pour connaître les colonnes d'années disponibles
    header_cols = pd.read_csv(INPUT, nrows=0).columns.tolist()
    Y_COLS = year_cols_in_range(header_cols)

    if not Y_COLS:
        raise ValueError("Aucune colonne d'année trouvée dans l'intervalle demandé.")

    print(f"✅ Années trouvées : {Y_COLS[0]} → {Y_COLS[-1]} ({len(Y_COLS)} années)")

    usecols = ID_COLS + Y_COLS

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    first_write = True

    for chunk in pd.read_csv(INPUT, usecols=usecols, chunksize=CHUNKSIZE, encoding="latin1"):
        # Filtrage items + elements
        chunk = chunk[chunk["Item"].isin(KEEP_ITEMS) & chunk["Element"].isin(KEEP_ELEMENTS)]
        if chunk.empty:
            continue

        # Wide -> Long
        long_df = chunk.melt(
            id_vars=ID_COLS,
            value_vars=Y_COLS,
            var_name="Year",
            value_name="Value",
        )

        # "Year" : Y1961 -> 1961
        long_df["Year"] = long_df["Year"].str.replace("Y", "", regex=False).astype("int16")

        # Nettoyage valeurs
        long_df["Value"] = pd.to_numeric(long_df["Value"], errors="coerce")
        long_df = long_df.dropna(subset=["Value"])
        long_df = long_df[long_df["Value"] > 0]  # supprimer les zéros

        # Colonnes finales
        out_cols = [
            "Area", "Area Code (M49)",
            "Item", "Item Code (CPC)",
            "Element", "Unit",
            "Year", "Value",
        ]
        long_df = long_df[out_cols]

        long_df.to_csv(OUTPUT, mode="w" if first_write else "a", index=False, header=first_write)
        first_write = False

    if first_write:
        print("⚠️  Aucune donnée trouvée avec ces filtres.")
    else:
        size_mb = OUTPUT.stat().st_size / (1024 * 1024)
        print(f"✅ Dataset créé : {OUTPUT}")
        print(f"   Taille : {size_mb:.2f} MB")
        # Aperçu rapide
        df = pd.read_csv(OUTPUT)
        print(f"   Lignes : {len(df):,}")
        print(f"   Cultures : {sorted(df['Item'].unique())}")
        print(f"   Années : {df['Year'].min()} → {df['Year'].max()}")
        print(f"   Pays/régions : {df['Area'].nunique()}")

if __name__ == "__main__":
    main()