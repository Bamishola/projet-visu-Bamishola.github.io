#!/usr/bin/env python3
"""
Convertit les données SAA (Statistique Agricole Annuelle) d'Excel en CSV exploitable
pour la visualisation D3.js
"""
import pandas as pd
import os

# Chemins
input_file = "SAA_2010-2024-définitives_donnees-DepartementalesetRegionales/SAA_2010-2024_définitives_donnees_departementales.xlsx"
output_dir = "data"

# Créer le dossier output s'il n'existe pas
os.makedirs(output_dir, exist_ok=True)

def clean_sheet(df, sheet_name):
    """
    Nettoie une feuille de données:
    - Trouve la ligne d'en-têtes
    - Extrait les colonnes pertinentes
    - Transforme les données en format long pour D3
    """
    # Chercher la ligne d'en-têtes (contient LIB_REG2, LIB_DEP, etc)
    header_row = None
    for idx in range(len(df)):
        row_str = ' '.join(map(str, df.iloc[idx].values))
        if 'LIB_REG2' in row_str and 'LIB_DEP' in row_str:
            header_row = idx
            break
    
    if header_row is None:
        print(f"  ❌ Impossible de trouver l'en-tête dans {sheet_name}")
        return None
    
    # Re-lire avec le bon en-tête
    df_clean = pd.read_excel(input_file, sheet_name=sheet_name, header=header_row)
    
    # Garder seulement les colonnes avec données
    df_clean = df_clean.dropna(axis=1, how='all')  # Supprimer colonnes vides
    
    # Garder les colonnes intéressantes
    id_vars = [col for col in ['LIB_REG2', 'LIB_DEP', 'LIB_SAA'] if col in df_clean.columns]
    
    # Identifier les colonnes de données (SURF_, PROD_, REND_)
    value_vars = [col for col in df_clean.columns if any(prefix in col for prefix in ['SURF_', 'PROD_', 'REND_'])]
    
    df_long = df_clean.melt(id_vars=id_vars, value_vars=value_vars, 
                             var_name='Metric', value_name='Value')
    
    # Extraire l'année et le type de métrique
    df_long['Year'] = df_long['Metric'].str.extract(r'(\d{4})')[0].astype(int)
    df_long['MetricType'] = df_long['Metric'].str.extract(r'(SURF|PROD|REND)')
    
    # Extraire le code département (ex: "01" de "01 - Ain")
    df_long['DepartmentCode'] = df_long['LIB_DEP'].str.extract(r'^(\d{2}|2[AB])')[0]
    
    # Nettoyer les valeurs (convertir en float)
    df_long['Value'] = pd.to_numeric(df_long['Value'], errors='coerce')
    
    # Supprimer les lignes avec valeurs nulles
    df_long = df_long.dropna(subset=['Value'])
    
    # Sélectionner les colonnes finales
    df_long = df_long[['DepartmentCode', 'LIB_REG2', 'LIB_DEP', 'LIB_SAA', 
                        'Year', 'MetricType', 'Value']]
    
    df_long.columns = ['DepCode', 'Region', 'Department', 'Product', 
                       'Year', 'MetricType', 'Value']
    
    return df_long

# Traiter chaque feuille
sheets = ['COP', 'FOU', 'IND']  # Céréales/Oléagineux, Fruits/Légumes, Industrie

all_data = []

for sheet in sheets:
    print(f"Traitement de la feuille '{sheet}'...")
    df = clean_sheet(pd.read_excel(input_file, sheet_name=sheet), sheet)
    if df is not None:
        all_data.append(df)
        print(f"  ✅ {len(df)} lignes")

# Combiner toutes les données
df_combined = pd.concat(all_data, ignore_index=True)

# Sauvegarder
output_file = f"{output_dir}/saa_agricole_departements_2010_2024.csv"
df_combined.to_csv(output_file, index=False, sep=';', encoding='utf-8')

print(f"\n✅ Fichier créé: {output_file}")
print(f"   Total: {len(df_combined)} lignes")
print(f"\n   Aperçu:")
print(df_combined.head(10))
