"""Teste de contrato visual com respostas simuladas. Não representa Neon real."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
JS=Path(__file__).resolve().parents[1].joinpath('public/vitrine-uk.js').read_text()
store={}
calls=[]

def handler(route):
    req=route.request; path=req.url.split('/api/')[1]
    method=req.method
    data=req.post_data_json if req.post_data else {}
    calls.append((path,method))
    if path=='uk/sessao': out={'autenticado':True,'user':{'usuario':'admin','perfil':'admin','nome':'Central'}}
    elif path=='uk/sacola':out={'itens':list(store.values()),'autenticado':True}
    elif path=='uk/sacola/itens' and method=='POST':
        k=(data['produtoId'],data.get('variacaoId',''))
        q=min(99,store.get(k,{}).get('quantidade',0)+int(data['quantidade']))
        store[k]={'produtoId':k[0],'variacaoId':k[1],'quantidade':q};out={'itens':list(store.values())}
    elif path=='uk/sacola/itens' and method=='PATCH':
        k=(data['produtoId'],data.get('variacaoId',''));store[k]['quantidade']=data['quantidade'];out={'itens':list(store.values())}
    elif path=='uk/sacola/itens' and method=='DELETE':
        k=(data['produtoId'],data.get('variacaoId',''));store.pop(k,None);out={'itens':list(store.values())}
    elif path=='uk/sacola/importar':out={'itens':list(store.values())}
    elif path=='vitrine/carrinho':out={'itens':[]}
    else:out={'erro':'não configurado '+path}
    route.fulfill(status=200,content_type='application/json',body=json.dumps(out))

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for width in [360,1366]:
        context=browser.new_context(viewport={'width':width,'height':800},ignore_https_errors=True)
        page=context.new_page()
        page.route('https://uti.example/api/**',handler)
        page.set_content('<html><head><base href="https://uti.example/"></head><body><span data-bag-count hidden>0</span><span data-cart-count hidden>0</span></body></html>')
        page.add_script_tag(content=JS)
        page.evaluate('()=>UK.ready')
        if width==360:
            assert page.evaluate("()=>UK.auth().user.usuario")=='admin'
            page.evaluate("async()=>{await UK.adicionarSacola('item-A','',2);await UK.adicionarSacola('item-B','cor-azul',1)}")
            assert page.evaluate("()=>UK.sacola().reduce((s,x)=>s+x.quantidade,0)")==3
        else:
            assert page.evaluate("()=>UK.sacola().reduce((s,x)=>s+x.quantidade,0)")==3
            page.evaluate("async()=>await UK.atualizarSacola('item-A','',3)")
            assert page.evaluate("()=>UK.sacola().find(x=>x.produtoId==='item-A').quantidade")==3
            page.evaluate("async()=>await UK.removerSacola('item-B','cor-azul')")
            assert len(page.evaluate('()=>UK.sacola()'))==1
        assert page.locator('[data-bag-count]').inner_text() in ['3','4']
        print('PASS',width,'px',page.evaluate('()=>UK.sacola()'))
        context.close()
    browser.close()
print('RESULTADO: UI de sacola compartilhada por backend mock passou. Não substitui homologação Neon.')
