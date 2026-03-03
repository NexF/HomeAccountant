"""修复分录行中非两位小数的金额 → 四舍五入到两位"""
import sqlite3

conn = sqlite3.connect("data/home_accountant.db")
c = conn.cursor()

# 查找并修复
c.execute("""
    SELECT id, debit_amount, credit_amount FROM journal_lines
    WHERE ROUND(debit_amount, 2) != debit_amount
       OR ROUND(credit_amount, 2) != credit_amount
""")
rows = c.fetchall()
print(f"需修复的行: {len(rows)}")

for r in rows:
    new_debit = round(r[1], 2)
    new_credit = round(r[2], 2)
    print(f"  id={r[0][:8]}.. D: {r[1]} -> {new_debit}, C: {r[2]} -> {new_credit}")
    c.execute("UPDATE journal_lines SET debit_amount=?, credit_amount=? WHERE id=?",
              (new_debit, new_credit, r[0]))

# 同样修复快照的 difference / external_balance / book_balance
c.execute("""
    SELECT id, external_balance, book_balance, difference FROM balance_snapshots
    WHERE ROUND(external_balance, 2) != external_balance
       OR ROUND(book_balance, 2) != book_balance
       OR ROUND(difference, 2) != difference
""")
snap_rows = c.fetchall()
print(f"\n需修复的快照: {len(snap_rows)}")
for r in snap_rows:
    new_ext = round(r[1], 2)
    new_book = round(r[2], 2)
    new_diff = round(r[3], 2)
    print(f"  id={r[0][:8]}.. ext: {r[1]}->{new_ext}, book: {r[2]}->{new_book}, diff: {r[3]}->{new_diff}")
    c.execute("UPDATE balance_snapshots SET external_balance=?, book_balance=?, difference=? WHERE id=?",
              (new_ext, new_book, new_diff, r[0]))

conn.commit()
print("\nDone!")

# 验证
c.execute("""
    SELECT COUNT(*) FROM journal_lines
    WHERE ROUND(debit_amount, 2) != debit_amount
       OR ROUND(credit_amount, 2) != credit_amount
""")
print(f"修复后仍不精确的行: {c.fetchone()[0]}")
