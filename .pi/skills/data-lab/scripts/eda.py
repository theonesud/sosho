#!/usr/bin/env python3
"""
eda.py: Quick exploratory data analysis for tabular data (CSV, JSON, Parquet, SQLite).
Outputs a compact, token-safe summary (<35 lines) to stdout.
"""
import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: eda.py <file.csv|tsv|json|parquet|sqlite> [table_name]", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"❌ Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    ext = os.path.splitext(file_path)[1].lower()

    try:
        import pandas as pd
        if ext in ('.csv', '.txt'):
            df = pd.read_csv(file_path, nrows=50000)
        elif ext == '.tsv':
            df = pd.read_csv(file_path, sep='\t', nrows=50000)
        elif ext == '.json':
            df = pd.read_json(file_path)
        elif ext == '.parquet':
            df = pd.read_parquet(file_path)
        elif ext in ('.sqlite', '.db'):
            import sqlite3
            conn = sqlite3.connect(file_path)
            table = sys.argv[2] if len(sys.argv) > 2 else None
            if not table:
                tables = pd.read_sql("SELECT name FROM sqlite_master WHERE type='table';", conn)
                print(f"Tables in SQLite DB: {tables['name'].tolist()}")
                table = tables['name'].iloc[0]
            df = pd.read_sql(f"SELECT * FROM {table} LIMIT 50000;", conn)
        else:
            print(f"Unsupported extension: {ext}", file=sys.stderr)
            sys.exit(1)

        print(f"=== [EDA SUMMARY: {os.path.basename(file_path)}] ===")
        print(f"• Shape: {df.shape[0]} rows × {df.shape[1]} columns")
        print(f"• Memory Usage: {df.memory_usage(deep=True).sum() / (1024*1024):.2f} MB")
        print("------------------------------------------------------------")
        
        # Column overview
        null_counts = df.isnull().sum()
        dtypes = df.dtypes
        print("Columns, Types & Missing:")
        for col in df.columns[:15]:
            nulls = null_counts[col]
            pct = (nulls / len(df)) * 100 if len(df) > 0 else 0
            print(f"  - {col}: {dtypes[col]} | {nulls} nulls ({pct:.1f}%)")
        if len(df.columns) > 15:
            print(f"  [... {len(df.columns) - 15} more columns omitted for brevity ...]")

        print("------------------------------------------------------------")
        # Numerical overview
        num_cols = df.select_dtypes(include=['number']).columns
        if len(num_cols) > 0:
            print(f"Numeric Stats ({len(num_cols)} columns):")
            stats = df[num_cols[:6]].describe().T[['mean', 'std', 'min', '50%', 'max']]
            print(stats.to_string())

        print("============================================================")

    except Exception as e:
        print(f"❌ Error during EDA: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
