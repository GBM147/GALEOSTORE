import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = process.env.PORT || 10000
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada')
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET não configurada')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '2mb' }))

const q = (sql, params=[]) => pool.query(sql, params)

async function init() {
  await q(`
CREATE TABLE IF NOT EXISTS admin_users (id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,sort_order INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY,name TEXT NOT NULL,brand TEXT DEFAULT '',category_id INT REFERENCES categories(id) ON DELETE SET NULL,description TEXT DEFAULT '',price NUMERIC(12,2) DEFAULT 0,cost NUMERIC(12,2) DEFAULT 0,stock INT DEFAULT 0,min_stock INT DEFAULT 0,image TEXT DEFAULT '',video TEXT DEFAULT '',active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS stock_movements (id SERIAL PRIMARY KEY,product_id INT NOT NULL REFERENCES products(id),type TEXT NOT NULL CHECK(type IN ('ENTRADA','SAIDA','AJUSTE')),quantity INT NOT NULL,stock_before INT NOT NULL,stock_after INT NOT NULL,reason TEXT DEFAULT '',reference_id TEXT,unit_cost NUMERIC(12,2) DEFAULT 0,user_id INT REFERENCES admin_users(id),created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS financial_categories (id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,type TEXT NOT NULL CHECK(type IN ('RECEITA','DESPESA')));
CREATE TABLE IF NOT EXISTS financial_accounts (id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,initial_balance NUMERIC(12,2) DEFAULT 0,active BOOLEAN DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS financial_entries (id SERIAL PRIMARY KEY,account_id INT REFERENCES financial_accounts(id),category_id INT REFERENCES financial_categories(id),type TEXT NOT NULL CHECK(type IN ('RECEITA','DESPESA')),description TEXT NOT NULL,amount NUMERIC(12,2) NOT NULL,due_date DATE,paid_at TIMESTAMPTZ,status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN ('PENDENTE','PAGO','CANCELADO')),recurring BOOLEAN DEFAULT FALSE,recurrence TEXT,reference_type TEXT,reference_id TEXT,user_id INT REFERENCES admin_users(id),created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS recurring_expenses (id SERIAL PRIMARY KEY,description TEXT NOT NULL,category_id INT REFERENCES financial_categories(id),account_id INT REFERENCES financial_accounts(id),amount NUMERIC(12,2) NOT NULL,due_day INT NOT NULL CHECK(due_day BETWEEN 1 AND 31),active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY,user_id INT REFERENCES admin_users(id),action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,details JSONB,created_at TIMESTAMPTZ DEFAULT NOW());
`)
  const defaults=[['Vendas','RECEITA'],['Outras receitas','RECEITA'],['Compra de mercadorias','DESPESA'],['Aluguel','DESPESA'],['Energia','DESPESA'],['Internet','DESPESA'],['Marketing','DESPESA'],['Salários','DESPESA'],['Impostos','DESPESA'],['Frete','DESPESA'],['Embalagens','DESPESA'],['Taxas','DESPESA'],['Outras despesas','DESPESA']]
  for (const [name,type] of defaults) await q('INSERT INTO financial_categories(name,type) VALUES($1,$2) ON CONFLICT(name) DO NOTHING',[name,type])
  await q("INSERT INTO financial_accounts(name) VALUES('Caixa da loja') ON CONFLICT(name) DO NOTHING")
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12)
    await q('INSERT INTO admin_users(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING',[process.env.ADMIN_EMAIL,hash])
  }
  // ACESSO TEMPORARIO DE VALIDACAO - remover apos os testes dos proprietarios.
  const demoEmail='acesso.teste@galeostore.com.br'
  const demoPassword='GaleoTeste#2026'
  const demoHash=await bcrypt.hash(demoPassword,12)
  await q('INSERT INTO admin_users(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING',[demoEmail,demoHash])
}

function auth(req,res,next){
  try { const token=(req.headers.authorization||'').replace(/^Bearer\s+/,''); if(!token) throw Error(); req.user=jwt.verify(token,process.env.JWT_SECRET); next() }
  catch { res.status(401).json({error:'Sessão inválida'}) }
}

app.get('/api/health',(req,res)=>res.json({ok:true}))
app.post('/api/auth/login',async(req,res)=>{
  const r=await q('SELECT * FROM admin_users WHERE email=$1',[req.body.email])
  if(!r.rowCount || !(await bcrypt.compare(req.body.password||'',r.rows[0].password_hash))) return res.status(401).json({error:'E-mail ou senha inválidos'})
  res.json({token:jwt.sign({id:r.rows[0].id,email:r.rows[0].email,role:'admin'},process.env.JWT_SECRET,{expiresIn:'12h'})})
})

app.get('/api/store',async(req,res)=>{
  const [products,categories]=await Promise.all([
    q("SELECT p.*,c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=true ORDER BY p.id DESC"),
    q('SELECT * FROM categories ORDER BY sort_order,id')
  ])
  res.json({products:products.rows,categories:categories.rows})
})

async function generateCurrentRecurring() {
 const rec=(await q('SELECT * FROM recurring_expenses WHERE active=true')).rows
 const month=new Date().toISOString().slice(0,7)
 for(const r of rec){
   const referenceId='recurring:'+r.id+':'+month
   const exists=await q('SELECT 1 FROM financial_entries WHERE reference_id=$1',[referenceId])
   if(!exists.rowCount){
     const day=String(r.due_day).padStart(2,'0')
     await q("INSERT INTO financial_entries(account_id,category_id,type,description,amount,due_date,status,recurring,recurrence,reference_type,reference_id) VALUES($1,$2,'DESPESA',$3,$4,$5,'PENDENTE',true,'MENSAL','RECURRING',$6)",[r.account_id,r.category_id,r.description,r.amount,month+'-'+day,referenceId])
   }
 }
}

app.get('/api/admin/dashboard',auth,async(req,res)=>{
  await generateCurrentRecurring()
  const [p,s,income,expense,payable,receivable]=await Promise.all([
    q("SELECT COUNT(*)::int count,COALESCE(SUM(stock),0)::int stock,COUNT(*) FILTER (WHERE stock<=min_stock AND active)::int low_stock FROM products"),
    q("SELECT COALESCE(SUM(quantity) FILTER (WHERE type='ENTRADA'),0)::int entradas,COALESCE(SUM(quantity) FILTER (WHERE type='SAIDA'),0)::int saidas FROM stock_movements WHERE created_at>=date_trunc('month',CURRENT_DATE)"),
    q("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE type='RECEITA' AND status='PAGO' AND date_trunc('month',COALESCE(paid_at,created_at))=date_trunc('month',CURRENT_DATE)"),
    q("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE type='DESPESA' AND status='PAGO' AND date_trunc('month',COALESCE(paid_at,created_at))=date_trunc('month',CURRENT_DATE)"),
    q("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE type='DESPESA' AND status='PENDENTE'"),
    q("SELECT COALESCE(SUM(amount),0) total FROM financial_entries WHERE type='RECEITA' AND status='PENDENTE'")
  ])
  res.json({products:p.rows[0],stock:s.rows[0],income:income.rows[0].total,expense:expense.rows[0].total,payable:payable.rows[0].total,receivable:receivable.rows[0].total})
})

app.get('/api/admin/products',auth,async(req,res)=>res.json((await q('SELECT p.*,c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC')).rows))
app.post('/api/admin/products',auth,async(req,res)=>{
  const {name,brand,category_id,description,price,cost,stock,min_stock,image,video}=req.body
  const r=await q('INSERT INTO products(name,brand,category_id,description,price,cost,stock,min_stock,image,video) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[name,brand||'',category_id||null,description||'',price||0,cost||0,stock||0,min_stock||0,image||'',video||''])
  if(Number(stock)>0) await q("INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,user_id) VALUES($1,'ENTRADA',$2,0,$2,'Estoque inicial',$3)",[r.rows[0].id,Number(stock),req.user.id])
  res.status(201).json(r.rows[0])
})
app.put('/api/admin/products/:id',auth,async(req,res)=>{
  const old=(await q('SELECT * FROM products WHERE id=$1',[req.params.id])).rows[0]; if(!old) return res.status(404).json({error:'Produto não encontrado'})
  const b=req.body; const newStock=Number(b.stock); const r=await q('UPDATE products SET name=$1,brand=$2,category_id=$3,description=$4,price=$5,cost=$6,stock=$7,min_stock=$8,image=$9,video=$10,active=$11,updated_at=NOW() WHERE id=$12 RETURNING *',[b.name,b.brand||'',b.category_id||null,b.description||'',b.price||0,b.cost||0,newStock,b.min_stock||0,b.image||'',b.video||'',b.active!==false,req.params.id])
  if(newStock!==old.stock) await q("INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,user_id) VALUES($1,'AJUSTE',$2,$3,$4,'Ajuste manual pelo painel',$5)",[req.params.id,newStock-old.stock,old.stock,newStock,req.user.id])
  res.json(r.rows[0])
})

app.post('/api/admin/stock',auth,async(req,res)=>{
  const {product_id,type,quantity,reason,unit_cost,reference_id}=req.body
  const n=Number(quantity); if(!['ENTRADA','SAIDA','AJUSTE'].includes(type)||!Number.isInteger(n)||n<=0) return res.status(400).json({error:'Movimentação inválida'})
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const p=(await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[product_id])).rows[0]
    if(!p) throw Error('Produto não encontrado')
    const after=type==='ENTRADA'?p.stock+n:type==='SAIDA'?p.stock-n:n
    if(after<0) throw Error('Estoque insuficiente')
    await client.query('UPDATE products SET stock=$1,updated_at=NOW() WHERE id=$2',[after,product_id])
    await client.query('INSERT INTO stock_movements(product_id,type,quantity,stock_before,stock_after,reason,reference_id,unit_cost,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[product_id,type,n,p.stock,after,reason||'',reference_id||null,unit_cost||0,req.user.id])
    await client.query('COMMIT'); res.json({before:p.stock,after})
  } catch(e){ await client.query('ROLLBACK'); res.status(400).json({error:e.message}) } finally { client.release() }
})
app.get('/api/admin/stock/movements',auth,async(req,res)=>res.json((await q('SELECT m.*,p.name product FROM stock_movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 500')).rows))

app.get('/api/admin/finance/entries',auth,async(req,res)=>res.json((await q('SELECT e.*,c.name category,a.name account FROM financial_entries e LEFT JOIN financial_categories c ON c.id=e.category_id LEFT JOIN financial_accounts a ON a.id=e.account_id ORDER BY e.due_date DESC NULLS LAST,e.id DESC LIMIT 500')).rows))
app.get('/api/admin/finance/categories',auth,async(req,res)=>res.json((await q('SELECT * FROM financial_categories ORDER BY type,name')).rows))
app.get('/api/admin/finance/accounts',auth,async(req,res)=>res.json((await q('SELECT * FROM financial_accounts WHERE active=true ORDER BY name')).rows))
app.post('/api/admin/finance/entries',auth,async(req,res)=>{
  const b=req.body
  const r=await q('INSERT INTO financial_entries(account_id,category_id,type,description,amount,due_date,status,paid_at,recurring,recurrence,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[b.account_id||null,b.category_id||null,b.type,b.description,b.amount,b.due_date||null,b.status||'PENDENTE',b.status==='PAGO'?new Date():null,b.recurring===true,b.recurrence||null,req.user.id])
  res.status(201).json(r.rows[0])
})
app.patch('/api/admin/finance/entries/:id/pay',auth,async(req,res)=>{
  const r=await q("UPDATE financial_entries SET status='PAGO',paid_at=NOW() WHERE id=$1 RETURNING *",[req.params.id]); res.json(r.rows[0])
})
app.post('/api/admin/finance/recurring',auth,async(req,res)=>{
  const b=req.body; const r=await q('INSERT INTO recurring_expenses(description,category_id,account_id,amount,due_day) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.description,b.category_id||null,b.account_id||null,b.amount,b.due_day]); res.status(201).json(r.rows[0])
})
app.get('/api/admin/finance/recurring',auth,async(req,res)=>res.json((await q('SELECT r.*,c.name category,a.name account FROM recurring_expenses r LEFT JOIN financial_categories c ON c.id=r.category_id LEFT JOIN financial_accounts a ON a.id=r.account_id WHERE r.active=true ORDER BY r.due_day')).rows))

const dist=path.join(__dirname,'..','dist')
app.use(express.static(dist))
app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')))
init().then(()=>app.listen(port,()=>console.log('GALEO API running on '+port))).catch(e=>{console.error(e);process.exit(1)})
