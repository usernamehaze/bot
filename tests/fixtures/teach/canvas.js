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
// the chart's notes, written across its middle (so a snip of the middle has something to teach)
x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
['Notes on the chart', 'January 120, February 150, March 190', 'April 260, May 340, June 450', 'Sales grew every month this half year', 'The biggest jump was from May to June', 'Growth is faster near the end', 'Source: shop records'].forEach((t, i) => x.fillText(t, c.width / 2, c.height * 0.33 + i * 30));
