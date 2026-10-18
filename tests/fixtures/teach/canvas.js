// a page drawn only on a canvas (like Google Docs, Sheets and Slides): no words in the page for Cassie to read
const c = document.getElementById('c'), x = c.getContext('2d');
c.width = innerWidth; c.height = innerHeight;
x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
x.strokeStyle = '#111'; x.lineWidth = 3;
x.beginPath(); x.moveTo(60, c.height - 60); x.lineTo(60, 40); x.moveTo(60, c.height - 60); x.lineTo(c.width - 40, c.height - 60); x.stroke();
x.beginPath(); x.moveTo(60, c.height - 80);
for (let i = 1; i <= 10; i++) x.lineTo(60 + i * (c.width - 120) / 10, c.height - 80 - i * i * (c.height - 160) / 100);
x.stroke();
x.fillStyle = '#111'; x.font = 'bold 28px sans-serif'; x.fillText('Sales by month', 90, 70);
