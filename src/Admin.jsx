import { useEffect, useState } from 'react'

const api=async(path,options={})=>{
 const h=new Headers(options.headers||{}); const token=localStorage.getItem('galeo-admin-token'); if(token) h.set('Authorization','Bearer '+token)
 if(options.body && typeof options.body!=='string') { h.set('Content-Type','application/json'); options.body=JSON.stringify(options.body) }
 const r=await fetch(path,{...options,headers:h}); const d=await r.json().catch(()=>null); if(!r.ok) throw Error(d?.error||'Erro'); return d
}
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})

function Login({onLogin}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('')
 async function submit(e){e.preventDefault();setError('');try{const d=await api('/api/auth/login',{method:'POST',body:{email,password}});if(!d||!d.token)throw Error('O servidor não retornou um token de acesso. Tente novamente em alguns segundos.');localStorage.setItem('galeo-admin-token',d.token);onLogin()}catch(e){setError(e?.message||'Não foi possível entrar no painel.')}}
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
