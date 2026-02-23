import pandas as pd
from pathlib import Path

# ---------- CONFIG ----------
INPUT = Path("data/Production_Crops_Livestock_E_All_Data/Production_Crops_Livestock_E_All_Data_NOFLAG.csv")
OUTPUT = Path("data/data2/my_faostat_subset_long.csv")

# Tes 8 cultures
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

# Tes 3 éléments (noms comme dans le fichier)
KEEP_ELEMENTS = {"Area harvested", "Yield", "Production"}

# Période (modifie si tu veux)
YEAR_START = 1980
YEAR_END = 2024

CHUNKSIZE = 50_000  # tu peux monter/descendre selon ton PC

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

    # On lit juste l'en-tête pour connaître les colonnes d'années disponibles
    header_cols = pd.read_csv(INPUT, nrows=0).columns.tolist()
    Y_COLS = year_cols_in_range(header_cols)

    if not Y_COLS:
        raise ValueError("Aucune colonne d'année trouvée dans l'intervalle demandé.")

    usecols = ID_COLS + Y_COLS

    # On écrit au fur et à mesure (append) pour éviter de stocker tout en mémoire
    first_write = True

    for chunk in pd.read_csv(INPUT, usecols=usecols, chunksize=CHUNKSIZE):
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

        # "Year" : Y1980 -> 1980
        long_df["Year"] = long_df["Year"].str.replace("Y", "", regex=False).astype("int16")

        # Nettoyage valeurs : NaN / vides
        # (Certaines lignes Yield ont des trous -> NaN)
        long_df["Value"] = pd.to_numeric(long_df["Value"], errors="coerce")
        long_df = long_df.dropna(subset=["Value"])

        # Optionnel : enlever les zéros (si tu ne veux pas de "0" qui encombre)
        # long_df = long_df[long_df["Value"] != 0]

        # Colonnes finales (tu peux garder les codes si tu veux)
        out_cols = [
            "Area", "Area Code (M49)",
            "Item", "Item Code (CPC)",
            "Element", "Unit",
            "Year", "Value",
        ]
        long_df = long_df[out_cols]

        # Export (append)
        long_df.to_csv(OUTPUT, mode="w" if first_write else "a", index=False, header=first_write)
        first_write = False

    if first_write:
        print("Aucune donnée trouvée avec ces filtres (items/elements/years).")
    else:
        print(f"✅ Dataset créé: {OUTPUT} ({OUTPUT.stat().st_size / (1024*1024):.2f} MB)")

if __name__ == "__main__":
    # main()
    data = pd.read_csv(OUTPUT)
    print(data.shape)