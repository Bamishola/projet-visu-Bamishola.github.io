#!/usr/bin/env python3
"""
Convertit les données SAA (Statistique Agricole Annuelle) d'Excel en CSV
"""
import pandas as pd
import os

input_file = "SAA_2010-2024-définitives_donnees-DepartementalesetRegionales/SAA_2010-2024_définitives_donnees_departementales.xlsx"
output_dir = "data"
os.makedirs(output_dir, exist_ok=True)

def process_sheet(sheet_name):
    """Traite une feuille Excel"""
    print(f"\nTraitement de '{sheet_name}'...")
    
    # Lire la feuille (header à la ligne 5)
    df = pd.read_excel(input_file, sheet_name=sheet_name, header=5)
    
    # Garder seulement les colonnes utiles
    id_cols = [c for c in ['LIB_REG2', 'LIB_DEP', 'LIB_SAA'] if c in df.columns]
    data_cols = [c for c in df.columns if any(x in str(c) for x in ['SURF_', 'PROD_', 'REND_'])]
    
    df = df[id_cols + data_cols]
    
    # Transformer en format long
    df_long = df.melt(id_vars=id_cols, value_vars=data_cols, var_name='Metric', value_name='Value')
    
    # Extraire année et type
    df_long['Year'] = df_long['Metric'].str.extract(r'_(\d{4})')[0]
    df_long['MetricType'] = df_long['Metric'].str.extract(r'(SURF|PROD|REND)')[0]
    
    # Extraire code département
    df_long['DepCode'] = df_long['LIB_DEP'].str.extract(r'^(\d{2}|2[AB])')[0]
    
    # Nettoyer
    df_long['Value'] = pd.to_numeric(df_long['Value'], errors='coerce')
    df_long = df_long.dropna(subset=['Value', 'Year', 'DepCode'])
    df_long['Year'] = df_long['Year'].astype(int)
    
    # Colonnes finales
    result = df_long[['DepCode', 'LIB_REG2', 'LIB_DEP', 'LIB_SAA', 'Year', 'MetricType', 'Value']]
    result.columns = ['DepCode', 'Region', 'Department', 'Product', 'Year', 'MetricType', 'Value']
    
    print(f"  ✅ {len(result)} lignes")
    return result

# Traiter
all_data = []
for sheet in ['COP', 'FOU', 'IND']:
    try:
        df = process_sheet(sheet)
        all_data.append(df)
    except Exception as e:
        print(f"  ❌ Erreur: {e}")

# Combiner
df_final = pd.concat(all_data, ignore_index=True)

# Sauvegarder
output_file = f"{output_dir}/saa_agricole.csv"
df_final.to_csv(output_file, index=False, sep=';', encoding='utf-8')

print(f"\n✅ Fichier créé: {output_file}")
print(f"   Total: {len(df_final)} lignes")
print(f"   Départements: {df_final['DepCode'].nunique()}")
print(f"   Années: {df_final['Year'].min()}-{df_final['Year'].max()}")
print(f"\n   Aperçu:")
print(df_final.head(10))
