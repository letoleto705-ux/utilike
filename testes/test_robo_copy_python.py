import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'robo-copy'))
from robo_copy import validar_copy,url_produto,Evidencia,exige_revisao

class Testes(unittest.TestCase):
 def test_url(self):
  self.assertEqual(url_produto('https://utilike.onrender.com','cj-123'),
                   'https://utilike.onrender.com/produto.html?id=cj-123')
  for bad in ['','x/../admin','x?foo=bar','x'*300]:
   with self.assertRaises(ValueError):url_produto('https://utilike.onrender.com',bad)
 def test_copy(self):
  sample='Conheça esta opção para sua rotina com um texto comercial claro e sem informações inventadas.'
  self.assertEqual(validar_copy(sample),sample)
  with self.assertRaises(ValueError):validar_copy('muito curto')
  with self.assertRaises(ValueError):validar_copy('a'*2001)
  with self.assertRaises(ValueError):validar_copy('\n'.join(['texto de divulgação']*16))
 def test_sensiveis(self):
  self.assertTrue(exige_revisao(Evidencia('1','url','Acessório erótico','Moda','','',[])))
  self.assertFalse(exige_revisao(Evidencia('1','url','Fone bluetooth','Eletrônicos','','',[])))
if __name__=='__main__':unittest.main()
