# Roadmap

Bu dosya yalnız tamamlanmamış veya gerçek kullanım ihtiyacına kadar ertelenmiş işleri takip eder.

## İlk npm Release

- [x] Fresh studio'da `designs/` henüz yokken `design_list()` çağrısının boş liste döndürdüğünü izole smoke test ile doğrula
- [ ] npm yayın kimlik doğrulamasını yapılandır (`NPM_TOKEN` veya Trusted Publishing)
- [ ] `v0.1.0` tag'ini yayınla; npm kurulumu ve GitHub Release'i doğrula

## Doğrulanmış Modelleme Açıkları

- [ ] Görsel referanslı organik formlar için form-fidelity akışını tamamla: modelleme öncesi siluet/kesit analizi, değişken kesit ve yüzey kanıtı, rounded-prism ikamesini reddeden completion gate ve tekrarlanabilir organik benchmark

## Ertelenen Kapsam

- [ ] Build123d-mcp için dar kapsamlı motion-check fixture'ları ve API önerisi hazırla
- [ ] CNC machining kuralları: fixturing, takım çapı ve erişim kısıtları
- [ ] Sheet metal kuralları: bend allowance, K-factor ve flat pattern
- [ ] Assembly tree ve BOM
- [ ] Gerçek çoklu üretim süreci ihtiyacı oluşursa `design.json` process modelini değerlendir
