/* Draws a shipping receipt for a package onto a canvas and lets the user
   save it (via the share sheet on mobile, or a direct download otherwise). */

function buildBarcodePattern(seedStr) {
  // Deterministic pseudo-barcode from the tracking number — decorative only, not scannable.
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const bars = [];
  for (let i = 0; i < 46; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    bars.push(2 + (seed % 7));
  }
  return bars;
}

async function generateReceiptCanvas(pkg) {
  const W = 900, H = 1250;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const ink = '#12203a';
  const dim = '#6b7690';
  const faint = '#9aa3b8';
  const amber = '#c98600';
  const line = '#dbe0ea';

  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, 190);

  // header
  ctx.fillStyle = ink;
  ctx.fillRect(56, 46, 40, 40);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px Georgia, serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('M', 76, 68);

  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText('MERIDIAN CARGO', 110, 58);
  ctx.fillStyle = dim;
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('GLOBAL LOGISTICS & FREIGHT TRACKING', 110, 80);

  ctx.fillStyle = amber;
  ctx.font = '700 13px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SHIPPING RECEIPT', W - 56, 58);
  ctx.fillStyle = faint;
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText('Generated ' + new Date().toLocaleString(), W - 56, 78);
  ctx.textAlign = 'left';

  ctx.strokeStyle = line;
  ctx.beginPath(); ctx.moveTo(56, 130); ctx.lineTo(W - 56, 130); ctx.stroke();

  // tracking number + barcode
  ctx.fillStyle = dim;
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText('TRACKING NUMBER', 56, 155);
  ctx.fillStyle = ink;
  ctx.font = '700 30px "Courier New", monospace';
  ctx.fillText(pkg.trackingNumber, 56, 182);

  const bars = buildBarcodePattern(pkg.trackingNumber);
  let bx = 560;
  const by = 150, bh = 46;
  bars.forEach((w, i) => {
    if (i % 2 === 0) { ctx.fillStyle = ink; ctx.fillRect(bx, by, w, bh); }
    bx += w;
  });

  let y = 230;
  function sectionLabel(text, yy) {
    ctx.fillStyle = amber;
    ctx.font = '700 11px Arial, sans-serif';
    ctx.fillText(text.toUpperCase(), 56, yy);
    ctx.strokeStyle = line;
    ctx.beginPath(); ctx.moveTo(56, yy + 10); ctx.lineTo(W - 56, yy + 10); ctx.stroke();
  }
  function fieldRow(label, value, yy, x0 = 56) {
    ctx.fillStyle = faint;
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText(label.toUpperCase(), x0, yy);
    ctx.fillStyle = ink;
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText(value || '—', x0, yy + 20);
  }

  sectionLabel('From', y);
  y += 34;
  fieldRow('Sender', pkg.senderName, y); y += 44;
  if (pkg.senderAddress) { fieldRow('Address', pkg.senderAddress, y); y += 44; }
  const senderContact = [pkg.senderPhone, pkg.senderEmail].filter(Boolean).join('   ·   ');
  if (senderContact) { fieldRow('Contact', senderContact, y); y += 44; }

  y += 14;
  sectionLabel('To', y);
  y += 34;
  fieldRow('Recipient', pkg.recipientName, y); y += 44;
  if (pkg.recipientAddress) { fieldRow('Address', pkg.recipientAddress, y); y += 44; }
  const recipContact = [pkg.recipientPhone, pkg.recipientEmail].filter(Boolean).join('   ·   ');
  if (recipContact) { fieldRow('Contact', recipContact, y); y += 44; }

  y += 14;
  sectionLabel('Shipment details', y);
  y += 34;
  fieldRow('Origin', pkg.origin, y, 56);
  fieldRow('Destination', pkg.destination, y, 490);
  y += 54;
  fieldRow('Date shipped', pkg.shippedAt ? new Date(pkg.shippedAt).toLocaleString() : '—', y, 56);
  fieldRow('Estimated delivery', pkg.estimatedDelivery ? new Date(pkg.estimatedDelivery + 'T00:00:00').toLocaleDateString() : '—', y, 490);
  y += 54;
  fieldRow('Service level', pkg.serviceLevel || 'Standard', y, 56);
  fieldRow('Weight', pkg.weight || '—', y, 490);
  y += 54;

  const contents = Array.isArray(pkg.contents) ? pkg.contents : (pkg.description ? [pkg.description] : []);
  sectionLabel('Package contents', y);
  y += 30;
  if (!contents.length) {
    ctx.fillStyle = faint; ctx.font = '13px Arial, sans-serif';
    ctx.fillText('No contents listed.', 56, y);
    y += 24;
  } else {
    contents.forEach(item => {
      ctx.fillStyle = ink;
      ctx.font = '13px Arial, sans-serif';
      ctx.fillText('•  ' + item, 56, y);
      y += 24;
    });
  }

  y += 20;
  ctx.fillStyle = faint;
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText('Status at time of issue: ' + (pkg.status || 'Label created'), 56, y);

  ctx.strokeStyle = line;
  ctx.beginPath(); ctx.moveTo(56, H - 70); ctx.lineTo(W - 56, H - 70); ctx.stroke();
  ctx.fillStyle = faint;
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Keep this receipt as proof of shipment. Track anytime with the number above.', W / 2, H - 44);
  ctx.textAlign = 'left';

  return canvas;
}

async function saveReceipt(pkg, btn) {
  const originalText = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const canvas = await generateReceiptCanvas(pkg);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const filename = `meridian-cargo-receipt-${pkg.trackingNumber}.png`;

    if (navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Meridian Cargo receipt', text: `Receipt for ${pkg.trackingNumber}` });
        if (btn) { btn.textContent = originalText; btn.disabled = false; }
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    alert("Couldn't generate the receipt — please try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}
