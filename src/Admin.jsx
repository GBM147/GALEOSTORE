import { useEffect, useState } from 'react'

const DEMO_EMAIL='acesso.teste@galeostore.com.br'
const DEMO_PASSWORD='GaleoTeste#2026'
const DEMO_TOKEN='galeo-demo-token'

const demoState=()=>{
  const saved=localStorage.getItem('galeo-demo-state')
  if(saved){try{return JSON.parse(saved)}catch{}}
  const state={
    products:[
      {id:1,name:'Camiseta Básica',brand:'Demo Brand',category:'Camisetas',price:89.9,cost:38,stock:24,min_stock:5,image:'',video:'',active:true},
      {id:2,name:'Calça Wide Leg',brand:'Demo Brand',category:'Calças',price:149.9,cost:70,stock:8,min_stock:6,image:'',video:'',active:true},
      {id:3,name:'Tênis Casual',brand:'Demo Brand',category:'Calçados',price:219.9,cost:110,stock:3,min_stock:4,image:'',video:'',active:true}
    ],
    entries:[
      {id:1,description:'Aluguel da loja',category:'Aluguel',due_date:'2026-10-10',amount:1800,status:'PENDENTE'},
      {id:2,description:'Internet',category:'Internet',due_date:'2026-10-08',amount:129.9,status:'PAGO'},
      {id:3,description:'Compra de mercadorias',category:'Compra de mercadorias',due_date:'2026-10-05',amount:950,status:'PENDENTE'}
    ],
    recurring:[
      {id:1,description:'Aluguel mensal',category:'Aluguel',amount:1800,due_day:10},
      {id:2,description:'Internet mensal',category:'Internet',amount:129.9,due_day:8}
    ],
    categories:[
      {id:1,name:'Compra de mercadorias',type:'DESPESA'},{id:2,name:'Aluguel',type:'DESPESA'},
      {id:3,name:'Energia',type:'DESPESA'},{id:4,name:'Internet',type:'DESPESA'},
      {id:5,name:'Marketing',type:'DESPESA'},{id:6,name:'Salários',type:'DESPESA'},
      {id:7,name:'Impostos',type:'DESPESA'},{id:8,name:'Frete',type:'DESPESA'},
      {id:9,name:'Embalagens',type:'DESPESA'},{id:10,name:'Taxas',type:'DESPESA'}
    ]
  }
  localStorage.setItem('galeo-demo-state',JSON.stringify(state))
  return state
}
const saveDemo=state=>localStorage.setItem('galeo-demo-state',JSON.stringify(state))
const mockApi=async(path,options={})=>{
  const state=demoState()
  const method=options.method||'GET'
  if(path==='/api/auth/login') return {token:DEMO_TOKEN,demo:true}
  if(path==='/api/admin/dashboard') {
    const stock=state.products.reduce((s,p)=>s+p.stock,0)
    const low=state.products.filter(p=>p.stock<=p.min_stock).length
    const entradas=12,saidas=7
    const income=0,expense=state.entries.filter(e=>e.status==='PAGO').reduce((s,e)=>s+Number(e.amount||0),0)
    const payable=state.entries.filter(e=>e.status==='PENDENTE').reduce((s,e)=>s+Number(e.amount||0),0)
    return {products:{count:state.products.length,stock,low_stock:low},stock:{entradas,saidas},income,expense,payable,receivable:0}
  }
  if(path==='/api/admin/products') return state.products
  if(path==='/api/admin/finance/entries') return state.entries
  if(path==='/api/admin/finance/categories') return state.categories
  if(path==='/api/admin/finance/recurring') return state.recurring
  if(path==='/api/admin/stock' && method==='POST'){
    const b=typeof options.body==='string'?JSON.parse(options.body):options.body
    const p=state.products.find(x=>x.id===Number(b.product_id))
    if(!p) throw Error('Produto não encontrado')
    const q=Number(b.quantity)
    if(b.type==='ENTRADA') p.stock+=q
    else if(b.type==='SAIDA'){if(p.stock<q)throw Error('Estoque insuficiente');p.stock-=q}
    saveDemo(state)
    return {before: b.type==='ENTRADA'?p.stock-q:p.stock+q, after:p.stock}
  }
  if(path==='/api/admin/finance/entries' && method==='POST'){
    const b=typeof options.body==='string'?JSON.parse(options.body):options.body
    const entry={id:Date.now(),description:b.description,category:(state.categories.find(c=>c.id===Number(b.category_id))||{}).name||'Outras despesas',due_date:b.due_date||'—',amount:Number(b.amount||0),status:b.status||'PENDENTE'}
    state.entries.unshift(entry); saveDemo(state); return entry
  }
  if(path.startsWith('/api/admin/finance/entries/') && method==='PATCH'){
    const id=Number(path.split('/').slice(-2,-1)[0]); const e=state.entries.find(x=>x.id===id)
    if(e)e.status='PAGO'; saveDemo(state); return e||{}
  }
  if(path==='/api/admin/finance/recurring' && method==='POST'){
    const b=typeof options.body==='string'?JSON.parse(options.body):options.body
    const rec={id:Date.now(),description:b.description,category:(state.categories.find(c=>c.id===Number(b.category_id))||{}).name||'Outras despesas',amount:Number(b.amount||0),due_day:Number(b.due_day||10)}
    state.recurring.unshift(rec); saveDemo(state); return rec
  }
  return {}
}
const api=async(path,options={})=>{
 const token=localStorage.getItem('galeo-admin-token')
 if(token===DEMO_TOKEN) return mockApi(path,options)
 const h=new Headers(options.headers||{}); if(token) h.set('Authorization','Bearer '+token)
 if(options.body && typeof options.body!=='string') { h.set('Content-Type','application/json'); options={...options,body:JSON.stringify(options.body)} }
 try {
   const r=await fetch(path,{...options,headers:h})
   const raw=await r.text()
   let d=null; try{d=raw?JSON.parse(raw):null}catch{}
   if(!r.ok) throw Error(d?.error||'Erro')
   return d
 } catch(e) {
   throw e
 }
}
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})

function Login({onLogin}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('')
 async function submit(e){e.preventDefault();setError('');try{let d;try{d=await api('/api/auth/login',{method:'POST',body:{email,password}});if((!d||!d.token)&&email===DEMO_EMAIL&&password===DEMO_PASSWORD)d={token:DEMO_TOKEN,demo:true}}catch(err){if(email===DEMO_EMAIL&&password===DEMO_PASSWORD)d={token:DEMO_TOKEN,demo:true};else throw err}if(!d||!d.token)throw Error('E-mail ou senha inválidos');localStorage.setItem('galeo-admin-token',d.token);onLogin()}catch(e){setError(e?.message||'Não foi possível entrar no painel.')}}
 return <main className="admin-login"><form onSubmit={submit}><span className="eyebrow">GALEO / ADMIN</span><h1>Painel administrativo.</h1><input placeholder="E-mail" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/><input placeholder="Senha" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/><button className="button button-primary">Entrar ↗</button>{error&&<p className="admin-error">{error}</p>}</form></main>
}

function Admin(){
 const [tab,setTab]=useState('dashboard'),[dash,setDash]=useState(null),[products,setProducts]=useState([]),[entries,setEntries]=useState([]),[categories,setCategories]=useState([]),[recurring,setRecurring]=useState([]),[loading,setLoading]=useState(true)
 const [modal,setModal]=useState(null)
 const load=async()=>{setLoading(true);try{const [d,p,e,c,r]=await Promise.all([api('/api/admin/dashboard'),api('/api/admin/products'),api('/api/admin/finance/entries'),api('/api/admin/finance/categories'),api('/api/admin/finance/recurring')]);setDash(d);setProducts(p);setEntries(e);setCategories(c);setRecurring(r)}finally{setLoading(false)}}
 useEffect(()=>{load()},[])
 async function stock(product,type){const qty=prompt(type==='ENTRADA'?'Quantidade que entrou:':'Quantidade que saiu:');if(!qty)return;try{await api('/api/admin/stock',{method:'POST',body:{product_id:product.id,type,quantity:Number(qty),reason:type==='ENTRADA'?'Compra de mercadoria':'Saída manual'}});await load()}catch(e){alert(e.message)}}
 async function pay(id){await api('/api/admin/finance/entries/'+id+'/pay',{method:'PATCH'});load()}
 function logout(){localStorage.removeItem('galeo-admin-token');location.reload()}
 return <div className="admin-shell">
  <aside className="admin-side"><div className="brand"><span className="brand-mark">G</span><span>GALEO</span></div>{[['dashboard','Visão geral'],['products','Produtos e estoque'],['finance','Financeiro'],['recurring','Contas recorrentes']].map(x=><button className={tab===x[0]?'admin-nav active':'admin-nav'} onClick={()=>setTab(x[0])} key={x[0]}>{x[1]}</button>)}<button className="admin-nav logout" onClick={logout}>Sair</button></aside>
  <main className="admin-main"><div className="admin-top"><div><span className="eyebrow">ADMIN / 001</span><h1>{tab==='dashboard'?'Visão geral':tab==='products'?'Produtos e estoque':tab==='finance'?'Financeiro':'Contas recorrentes'}</h1></div><button className="button button-primary" onClick={()=>setModal(tab==='products'?'stock':tab==='finance'?'expense':'recurring')}>{tab==='products'?'+ Movimentar estoque':tab==='finance'?'+ Registrar gasto':'+ Nova recorrência'}</button></div>
   {loading?<p>Carregando...</p>:tab==='dashboard'&&<><div className="metric-grid">{[['Produtos',dash.products.count],['Estoque',dash.products.stock+' un.'],['Entradas no mês','+'+dash.stock.entradas],['Saídas no mês','-'+dash.stock.saidas],['Receitas pagas',money(dash.income)],['Despesas pagas',money(dash.expense)],['A pagar',money(dash.payable)],['A receber',money(dash.receivable)]].map(x=><div className="metric" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong></div>)}</div><div className="admin-panel"><h2>Alertas</h2><p>{dash.products.low_stock} produto(s) no estoque mínimo ou abaixo.</p></div></>}
   {tab==='products'&&<div className="admin-panel"><table><thead><tr><th>Produto</th><th>Preço</th><th>Custo</th><th>Estoque</th><th></th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.category||'Sem categoria'}</small></td><td>{money(p.price)}</td><td>{money(p.cost)}</td><td><strong>{p.stock}</strong>{p.stock<=p.min_stock&&<small className="warn"> estoque baixo</small>}</td><td><button onClick={()=>stock(p,'ENTRADA')}>+ entrada</button> <button onClick={()=>stock(p,'SAIDA')}>− saída</button></td></tr>)}</tbody></table></div>}
   {tab==='finance'&&<div className="admin-panel"><table><thead><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>{entries.map(e=><tr key={e.id}><td>{e.description}</td><td>{e.category}</td><td>{e.due_date||'—'}</td><td>{money(e.amount)}</td><td>{e.status}</td><td>{e.status==='PENDENTE'&&<button onClick={()=>pay(e.id)}>Marcar pago</button>}</td></tr>)}</tbody></table></div>}
   {tab==='recurring'&&<div className="admin-panel"><table><thead><tr><th>Despesa</th><th>Categoria</th><th>Valor</th><th>Dia</th></tr></thead><tbody>{recurring.map(r=><tr key={r.id}><td>{r.description}</td><td>{r.category}</td><td>{money(r.amount)}</td><td>{r.due_day}</td></tr>)}</tbody></table></div>}
  </main>
  {modal&&<Modal type={modal} categories={categories} products={products} onClose={()=>setModal(null)} onDone={()=>{setModal(null);load()}}/>}
 </div>
}

function Modal({type,categories,products,onClose,onDone}){
 const [form,setForm]=useState({type:'DESPESA',status:'PENDENTE',due_day:10}); const set=(k,v)=>setForm(f=>({...f,[k]:v}))
 async function submit(e){e.preventDefault();try{if(type==='stock')await api('/api/admin/stock',{method:'POST',body:{...form,quantity:Number(form.quantity),product_id:Number(form.product_id)}});if(type==='expense')await api('/api/admin/finance/entries',{method:'POST',body:{...form,amount:Number(form.amount)}});if(type==='recurring')await api('/api/admin/finance/recurring',{method:'POST',body:{...form,amount:Number(form.amount),due_day:Number(form.due_day)}});onDone()}catch(e){alert(e.message)}}
 return <div className="modal-backdrop"><form className="admin-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose}>×</button><span className="eyebrow">NOVO LANÇAMENTO</span><h2>{type==='stock'?'Movimentar estoque':type==='expense'?'Registrar gasto':'Despesa recorrente'}</h2>
 {type==='stock'?<><select value={form.product_id||''} onChange={e=>set('product_id',e.target.value)} required><option value="">Produto</option>{products.map(p=><option value={p.id} key={p.id}>{p.name} — estoque {p.stock}</option>)}</select><select value={form.type||'ENTRADA'} onChange={e=>set('type',e.target.value)}><option>ENTRADA</option><option>SAIDA</option></select><input type="number" min="1" placeholder="Quantidade" onChange={e=>set('quantity',e.target.value)} required/><input placeholder="Motivo" onChange={e=>set('reason',e.target.value)}/></>:<><input placeholder="Descrição" onChange={e=>set('description',e.target.value)} required/><select onChange={e=>set('category_id',e.target.value)} required><option value="">Categoria</option>{categories.filter(c=>c.type==='DESPESA').map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><input type="number" step="0.01" placeholder="Valor" onChange={e=>set('amount',e.target.value)} required/><input type="date" onChange={e=>set('due_date',e.target.value)}/>{type==='expense'?<select onChange={e=>set('status',e.target.value)}><option>PENDENTE</option><option>PAGO</option></select>:<input type="number" min="1" max="31" placeholder="Dia do vencimento" onChange={e=>set('due_day',e.target.value)}/>}</>}
 <button className="button button-primary">Salvar</button></form></div>
}

export default function AdminGate(){const [logged,setLogged]=useState(!!localStorage.getItem('galeo-admin-token'));return logged?<Admin/>:<Login onLogin={()=>setLogged(true)}/>}
