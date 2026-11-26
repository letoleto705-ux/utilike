"""Installs Argos Translate en->pt language model. Requires network access once."""
import argostranslate.package
argostranslate.package.update_package_index()
packages = argostranslate.package.get_available_packages()
model = next((p for p in packages if p.from_code == 'en' and p.to_code == 'pt'), None)
if model is None:
    raise SystemExit('No en->pt package available')
argostranslate.package.install_from_path(model.download())
print('Argos en->pt model installed')
