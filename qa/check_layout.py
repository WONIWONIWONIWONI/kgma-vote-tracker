"""Check responsive card sizes and the collapsed record table in Chromium."""
import copy
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import struct
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT/'dist/data/history.json').read_text())
base = copy.deepcopy(data['snapshots'][-1])
base['totalVotes'] = 100000000
for team, votes in zip(base['top2'], (12345678, 9876543)):
    team.update(votes=votes, reportedShare=round(votes, 1)/1000000)
data['snapshots'] = []
for i in range(160):
    row = copy.deepcopy(base)
    row['sourceAt'] = (datetime(2026,10,7,23,15,tzinfo=timezone.utc)-timedelta(minutes=5*(159-i))).isoformat()
    for team, step in zip(row['top2'], (10,7)):
        team['votes'] += i*step
        team['reportedShare'] = round(team['votes']/row['totalVotes']*100,1)
    data['snapshots'].append(row)
data['historyCount'] = 160


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT/'dist')))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width in (320, 360, 390, 430, 768, 1280):
            context = browser.new_context(viewport={'width':width, 'height':844},
                                          is_mobile=width<=430, device_scale_factor=1)
            context.route('https://raw.githubusercontent.com/**', lambda route: route.fulfill(
                content_type='application/json', body=json.dumps(data)))
            context.grant_permissions(['clipboard-read','clipboard-write'])
            page = context.new_page()
            page.add_init_script("""window.pngText=[];window.pngOverflow=[];
              const original=CanvasRenderingContext2D.prototype.fillText;
              CanvasRenderingContext2D.prototype.fillText=function(value,x,y,...args){
                window.pngText.push(String(value));
                const m=this.measureText(value),s=this.getTransform().a;
                const left=x-(this.textAlign==='right'?m.width:this.textAlign==='center'?m.width/2:0);
                if(left < -1 || left+m.width > this.canvas.width/s+1 || y-m.actualBoundingBoxAscent < -1 || y+m.actualBoundingBoxDescent > this.canvas.height/s+1)
                  window.pngOverflow.push(String(value));
                return original.call(this,value,x,y,...args);
              };""")
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='networkidle')
            page.wait_for_function("document.querySelector('#sample-count').textContent && document.querySelector('#sample-count').textContent !== '0'")
            page.wait_for_timeout(600)
            metrics = page.evaluate("""() => ({
                viewport:innerWidth,body:document.documentElement.scrollWidth,
                leaders:[...document.querySelectorAll('.leader')].map(el=>({
                    w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})),
                panels:[...document.querySelectorAll('.panel')].map(el=>el.getBoundingClientRect().width),
                overlapping:[...document.querySelectorAll('.count-row')].some(el=>
                    el.querySelector('.vote-total').getBoundingClientRect().right>
                    el.querySelector('.share-value').getBoundingClientRect().left-1)
            })""")
            print(json.dumps({'width':width, **metrics, 'errors':errors}), flush=True)
            assert not errors, errors
            assert metrics['viewport'] == width, metrics
            assert metrics['body'] <= width, metrics
            assert not metrics['overlapping'], metrics
            assert page.locator('.gaps-panel, #gap-list').count() == 0
            assert page.locator('.hero-right #copy-button').count() == 1
            assert page.locator('.hero-right [data-image], #png-button').count() == 0
            assert page.locator('[data-image]').count() == 3
            assert page.locator('.leaders [data-image],.overview-bar [data-image]').count() == 0
            assert page.locator('#history-details [data-image]').count() == 0
            refresh_box=page.locator('#refresh-button').bounding_box()
            for button in ('copy-button',):
                box=page.locator('#'+button).bounding_box()
                assert box['y'] >= refresh_box['y']+refresh_box['height'], (button,box,refresh_box)
                assert box['x'] >= 0 and box['x']+box['width'] <= width
                assert abs(box['width']-refresh_box['width'])<0.1 and abs(box['height']-refresh_box['height'])<0.1
                assert box['width']==112 and box['height']==44
            image_positions=page.evaluate("""() => [...document.querySelectorAll('[data-image]')].map(button=>{
                const owner=button.closest('.leader,.overview-bar,.panel'), b=button.getBoundingClientRect(),p=owner.getBoundingClientRect();
                const labels=owner.matches('.leader')?[...owner.querySelectorAll('.artist-name,.share-value')]:[...owner.querySelectorAll('h2')];
                const overlaps=labels.some(label=>{const r=label.getBoundingClientRect();return r.left<b.right && r.right>b.left && r.top<b.bottom && r.bottom>b.top;});
                return {type:button.dataset.image,inside:b.left>=p.left&&b.right<=p.right&&b.top>=p.top&&b.bottom<=p.bottom,overlaps};
            })""")
            assert all(item['inside'] and not item['overlaps'] for item in image_positions), image_positions
            assert max(metrics['panels'])-min(metrics['panels']) < 1, metrics
            for metric in ('votes','share','gap'):
                page.locator(f'[data-metric={metric}]').click()
                svg=page.locator('#trend-chart')
                ymin=float(svg.get_attribute('data-ymin'))
                ymax=float(svg.get_attribute('data-ymax'))
                if metric in ('votes','share'):
                    assert ymin > 0, (metric,ymin,ymax)
                else:
                    assert ymin < ymax, (metric,ymin,ymax)
                ticks=svg.locator('.y-tick').all_text_contents()
                assert 3 <= len(ticks) <= 8 and len(set(ticks)) == len(ticks), ticks
                assert '자동 범위' in page.locator('#chart-axis-note').inner_text()
                assert 'NaN' not in svg.inner_html()
                bounds=page.evaluate('''() => {
                    const svg=document.querySelector('#trend-chart'),width=svg.viewBox.baseVal.width;
                    return [...svg.querySelectorAll('text')].every(el=>{
                        const b=el.getBBox();return b.x>=-1 && b.x+b.width<=width+1;
                    });
                }''')
                assert bounds, (width,metric)
            # A short gap window has much less change and must visibly zoom in.
            full_span=float(svg.get_attribute('data-ymax'))-float(svg.get_attribute('data-ymin'))
            page.locator('[data-range="1"]').click()
            zoom_span=float(svg.get_attribute('data-ymax'))-float(svg.get_attribute('data-ymin'))
            assert zoom_span < full_span, (full_span,zoom_span)
            page.locator('[data-range="all"]').click()
            page.locator('[data-metric="votes"]').click()
            cards = metrics['leaders']
            assert len(cards) == 2, metrics
            assert '3위' not in page.locator('body').inner_text()
            assert 'SHOWNU' not in page.locator('body').inner_text()
            assert page.locator('#hourly-list .hourly-row').count() == 6
            assert page.locator('.hourly-team').count() == 12
            assert page.locator('.hourly-badge').first.inner_text() == '집계 중'
            assert page.locator('.hourly-value').first.inner_text() == '+30표'
            assert page.locator('.hourly-value').nth(2).inner_text() == '+120표'
            page.locator('#hourly-more').click()
            assert page.locator('#hourly-list .hourly-row').count() == 9
            page.locator('#hourly-date').select_option(index=1)
            assert '2026-10-07' == page.locator('#hourly-date').input_value()
            assert page.locator('#hourly-list .hourly-row').count() == 5
            assert page.locator('.hourly-scroll').evaluate('(el)=>el.getBoundingClientRect().height')<=571
            assert max(c['w'] for c in cards)-min(c['w'] for c in cards)<1, metrics
            assert max(c['h'] for c in cards)-min(c['h'] for c in cards)<1, metrics
            if width <= 760:
                assert all(abs(w-cards[0]['w'])<1 for w in metrics['panels']), metrics
            assert not page.locator('#history-details').evaluate('(el)=>el.open')
            assert not page.locator('#history-body').is_visible()
            page.locator('.history-summary').click()
            assert page.locator('#history-body').is_visible()
            assert page.locator('#history-body tr').count() == 12
            page.locator('#load-more').click()
            assert page.locator('#history-body tr').count() == 24
            assert page.locator('.history-scroll').evaluate('(el)=>el.getBoundingClientRect().height')<=421
            page.locator('.history-summary').click()
            assert not page.locator('#history-body').is_visible()
            if width == 390:
                for metric in ('gap','share','votes'):
                    page.locator(f'[data-metric={metric}]').click()
                    assert page.locator('#trend-chart path').count() == (1 if metric=='gap' else 2)
                page.locator('.history-summary').click()
                with page.expect_download() as download:
                    page.locator('#csv-button').click()
                csv=Path(download.value.path()).read_text(encoding='utf-8-sig')
                assert len(csv.splitlines()) == 321
                assert 'SHOWNU' not in csv and '3위표차' not in csv
                page.locator('#copy-button').click()
                copied=page.evaluate('navigator.clipboard.readText()')
                assert '1위 RESCENE' in copied and '2위 RIIZE' in copied and '3위' not in copied
                page.evaluate('''() => {const original=KGMAImages.render;KGMAImages.render=model=>{window.lastImageModel=model;return original(model);};}''')
                def panel_image(kind, index=0):
                    page.evaluate('window.pngText=[];window.pngOverflow=[]')
                    with page.expect_download() as download:
                        page.locator(f'[data-image="{kind}"]').nth(index).click()
                    raw=Path(download.value.path()).read_bytes()
                    assert raw.startswith(b'\x89PNG') and len(raw)>3000
                    w,h=struct.unpack('>II',raw[16:24])
                    assert 0<w<=4096 and 0<h<=4096 and w*h<=8000000, (w,h)
                    assert not page.evaluate('window.pngOverflow'), page.evaluate('window.pngOverflow')
                    text=page.evaluate('window.pngText')
                    print(json.dumps({'image':kind,'width':w,'height':h,'texts':len(text)}),flush=True)
                    return text
                for metric in ('votes','share','gap'):
                    page.locator(f'[data-metric={metric}]').click()
                    png_text=panel_image('trend')
                    assert page.locator('#chart-axis-note').inner_text() in png_text
                    assert all(tick in png_text for tick in page.locator('.y-tick').all_text_contents())
                    assert '현재 득표 현황' in png_text
                    for i,name in enumerate(('RESCENE','RIIZE')):
                        assert str(i+1)+'위 · '+name in png_text
                        assert page.locator('.vote-value').nth(i).inner_text()+'표' in png_text
                        assert page.locator('.share-value').nth(i).inner_text() in png_text
                text=panel_image('pace')
                assert '+10표' in text and '+7표' in text
                page.locator('#hourly-date').select_option(index=0)
                assert page.locator('.hourly-row').count()==6
                text=panel_image('hourly')
                assert '00:00–01:00' in text and '08:00–09:00' in text
                assert '2026.10.08 · 선택 날짜의 모든 시간대' in text
                assert '+120표' in text and '+30표' in text and '집계 중' in text
                # A full day must also fit conservative mobile canvas limits.
                dimensions=page.evaluate('''() => {
                    const model=structuredClone(window.lastImageModel);model.rows=Array.from({length:24},()=>model.rows[0]);
                    window.pngOverflow=[];const canvas=KGMAImages.render(model),result={w:canvas.width,h:canvas.height};
                    canvas.width=1;canvas.height=1;return result;
                }''')
                assert dimensions['h']<=4096 and dimensions['w']*dimensions['h']<=8000000,dimensions
                assert not page.evaluate('window.pngOverflow')
            assert not errors, errors
            context.close()
        browser.close()
finally:
    server.shutdown()
