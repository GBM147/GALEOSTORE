import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {createPostalCodeLookup,normalizePostalCode,registerPostalCodeLookup} from './postal-codes.js'

const address={cep:'01246-000',logradouro:'Rua de teste',bairro:'Centro',localidade:'São Paulo',uf:'SP',ibge:'unused-private-provider-data'}
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data})

test('postcodes retain leading zeroes and invalid values never call a provider',async()=>{
  assert.equal(normalizePostalCode('01246-000'),'01246000')
  assert.equal(normalizePostalCode('01246000'),'01246000')
  let calls=0
  const lookup=createPostalCodeLookup({fetchImpl:async()=>{calls++;return response(address)}})
  for(const value of ['',null,12345678,'01246x000','1234567','123456789','https://internal/','01246000\n'])await assert.rejects(lookup(value),error=>error.status===400&&error.code==='POSTAL_CODE_INVALID')
  assert.equal(calls,0)
})

test('a successful lookup returns only address fields and caches a defensive copy',async()=>{
  const calls=[]
  const lookup=createPostalCodeLookup({fetchImpl:async(url,options)=>{calls.push({url,options});return response(address)}})
  const first=await lookup('01246-000')
  assert.deepEqual(first,{postal_code:'01246000',street:'Rua de teste',neighborhood:'Centro',city:'São Paulo',state:'SP'})
  first.street='A local change'
  assert.equal((await lookup('01246000')).street,'Rua de teste')
  assert.equal(calls.length,1)
  assert.equal(calls[0].url,'https://viacep.com.br/ws/01246000/json/')
  assert.equal(calls[0].options.redirect,'error')
  assert.equal(calls[0].options.body,undefined)
})

test('an unavailable first provider falls back while a missing postcode stays a clear404',async()=>{
  let calls=0
  const lookup=createPostalCodeLookup({fetchImpl:async()=>++calls===1?response({},503):response({cep:'01246000',street:'Rua de teste',neighborhood:'Centro',city:'São Paulo',state:'SP'})})
  assert.equal((await lookup('01246000')).city,'São Paulo');assert.equal(calls,2)
  const missing=createPostalCodeLookup({fetchImpl:async()=>response({erro:true})})
  await assert.rejects(missing('00000000'),error=>error.status===404&&error.code==='POSTAL_CODE_NOT_FOUND')
})

test('generic city postcodes may leave street and neighbourhood for manual completion',async()=>{
  const lookup=createPostalCodeLookup({fetchImpl:async()=>response({...address,logradouro:'',bairro:''})})
  const value=await lookup('01246000')
  assert.equal(value.street,'');assert.equal(value.neighborhood,'');assert.equal(value.state,'SP')
})

test('mismatched/malformed provider data is never used and failures are sanitized',async()=>{
  for(const value of [{...address,cep:'99999-999'},{...address,uf:'XX'},{...address,localidade:''},{...address,logradouro:{}},null]){
    const lookup=createPostalCodeLookup({fetchImpl:async()=>response(value)})
    await assert.rejects(lookup('01246000'),error=>error.status===503&&error.code==='POSTAL_CODE_UNAVAILABLE')
  }
  const lookup=createPostalCodeLookup({fetchImpl:async()=>{throw new Error('private provider response')}})
  await assert.rejects(lookup('01246000'),error=>!error.message.includes('private'))
})

test('timeouts abort each provider and concurrent requests share a bounded lookup',async()=>{
  let aborted=0
  const timeout=createPostalCodeLookup({timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new Error('abort'))},{once:true}))})
  await assert.rejects(timeout('01246000'),error=>error.status===503);assert.equal(aborted,2)
  let release,calls=0
  const gate=new Promise(resolve=>{release=resolve})
  const lookup=createPostalCodeLookup({fetchImpl:async()=>{calls++;await gate;return response(address)}})
  const one=lookup('01246000'),two=lookup('01246-000');release()
  assert.deepEqual(await one,await two);assert.equal(calls,1)
})

test('expired and evicted entries are fetched again',async()=>{
  let clock=0,calls=0
  const lookup=createPostalCodeLookup({cacheTtlMs:10,maxEntries:1,now:()=>clock,fetchImpl:async url=>{calls++;const code=url.match(/\/(\d{8})\//)?.[1];return response({...address,cep:code})}})
  await lookup('01246000');clock=11;await lookup('01246000');await lookup('01001000');await lookup('01246000')
  assert.equal(calls,4)
})

test('the public same-origin route needs no account and preserves safe error statuses',async t=>{
  const app=express();registerPostalCodeLookup(app,{lookup:createPostalCodeLookup({fetchImpl:async()=>response(address)})})
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const base='http://127.0.0.1:'+server.address().port
  const ok=await fetch(base+'/api/store/postal-codes/01246000');assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal((await ok.json()).city,'São Paulo')
  const invalid=await fetch(base+'/api/store/postal-codes/invalid');assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'POSTAL_CODE_INVALID')
})
