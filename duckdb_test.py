import duckdb

con = duckdb.connect()

# Single year
con.sql("""
    SELECT GENHLTH_lbl, COUNT(*) AS n
    FROM read_parquet('hf://datasets/hesscl/quackrfss/data/BRFSS_2024.parquet')
    GROUP BY 1 ORDER BY 2 DESC
""").show()

# Trend across all years
con.sql("""
    SELECT
        YEAR,
        ROUND(100.0 * COUNT(*) FILTER (
                  WHERE UPPER(TRIM(GENHLTH_lbl)) IN ('FAIR', 'POOR')
              )
              / COUNT(*), 1) AS pct_fair_poor
    FROM read_parquet(
        'hf://datasets/hesscl/quackrfss/data/BRFSS_*.parquet',
        union_by_name = true
    )
    WHERE GENHLTH_lbl IS NOT NULL
    GROUP BY 1 ORDER BY 1
""").show()
