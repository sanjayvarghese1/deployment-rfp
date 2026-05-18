import sqlite3, json, sys

db = r'backend/app/procurelink_jobs.sqlite3'
job_id = 'd74a6a7f-d7c4-4441-a550-704c0da1d53f'
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
row = cur.execute('SELECT * FROM background_jobs WHERE job_id = ?', (job_id,)).fetchone()
if not row:
    print(f'Job {job_id} not found')
    sys.exit(0)
result = {k: row[k] for k in row.keys()}
for key in ('progress','result','decomposition','request'):
    try:
        if result.get(key):
            result[key] = json.loads(result[key])
    except Exception:
        pass
print(json.dumps(result, indent=2, ensure_ascii=False))
conn.close()
