# -*- coding: utf-8 -*-
"""Observador isolado: nao altera a rotina de galeria nem publica produtos.
Le o preco atual do bloco principal do AliExpress. Falhas retornam revisao.
"""
import re
from datetime import datetime, timezone

SCRIPT = r"""
const visible = el => {
  if (!el || !el.getClientRects().length) return false;
  const s=getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
};
const excluded = el => !!el.closest('del,s,[class*="original"],[class*="old-price"],[class*="oldPrice"],[class*="installment"],[class*="recommend"],[class*="review"],[class*="coupon"],[class*="discount"],[class*="tax"],[class*="shipping"]');
const selectors = [
  'span[class*="price-default--current--"]',
  'span[class*="price--current--"]',
  '[class*="price-current"] span',
  '[class*="product-price"] [class*="current"] span'
];
const out=[];
for (const selector of selectors) {
  const matches=[];
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el) || excluded(el)) continue;
    const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
    if (/^R\$\s*[\d.]+,\d{2}$/.test(t) || /^R\$\s*[\d.]+,\d{2}\s*$/.test(t)) {
      const rect=el.getBoundingClientRect();
      matches.push({text:t, selector, y:Math.round(rect.y), x:Math.round(rect.x)});
    }
  }
  if (matches.length) {out.push(...matches);break;}
}
const page=document.body?.innerText||'';
const hasFirstPurchase=/(oferta\s*1[ªaº]?\s*compra|primeira\s*compra|novo\s*usu[aá]rio|new\s*user\s*deal)/i.test(page);
const variants=Array.from(document.querySelectorAll('[class*="sku"] [class*="selected"],[class*="sku"] [class*="active"]')).filter(visible).map(x=>(x.innerText||x.getAttribute('title')||'').trim()).filter(Boolean).slice(0,4);
return {candidates:out, firstPurchase:hasFirstPurchase, variants, url:location.href};
"""

def parse_brl(value):
    m=re.fullmatch(r'R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),([0-9]{2})',str(value).strip())
    if not m:return None
    whole=m.group(1).replace('.','')
    number=int(whole)+int(m.group(2))/100
    return round(number,2) if 0<number<=1000000 else None

def observe(driver):
    """Retorna leitura vinculada a URL; nao confunde cupom/parcelas/impostos."""
    raw=driver.execute_script(SCRIPT) or {}
    candidates=raw.get('candidates') or []
    prices=[parse_brl(x.get('text','')) for x in candidates if isinstance(x,dict)]
    prices=[x for x in prices if x is not None]
    distinct=set(prices)
    first=bool(raw.get('firstPurchase'))
    price=prices[0] if len(distinct)==1 else None
    status=('revisao_preco_ambiguo_ou_ausente' if price is None else
            'observado_oferta_primeira_compra_revisar' if first else
            'observado_na_pagina_nao_confirmado')
    return {
        'preco_observado':price,
        'moeda_observada':'BRL' if price is not None else None,
        'preco_status':status,
        'preco_tipo':'primeira_compra_possivel' if first else 'preco_atual_exibido',
        'preco_fonte':'elemento_preco_principal' if price is not None else 'nao_identificada',
        'preco_verificado_em':datetime.now(timezone.utc).isoformat(),
        'preco_variante':' | '.join(raw.get('variants') or [])[:200],
        'preco_url_observada':raw.get('url','')[:600],
    }
