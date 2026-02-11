require('dotenv').config();
const { fetchOrdersBatch } = require('./server/services/shopee.cjs');
const fs = require('fs');

async function debugBatch() {
    console.log('--- DEBUG INFO ---');
    console.log('TKSIEURE_TOKEN:', process.env.TKSIEURE_TOKEN ? 'Đã có (Length: ' + process.env.TKSIEURE_TOKEN.length + ')' : 'CHƯA CÓ!');
    console.log('------------------\n');

    const cookies = [
        ".QXpxaWZvNHM0cVhyYWV3eBqeQ8TZ4gGWbUhMs7u+uAp+niKwo1ZMQFPsyfmoyYwkObX6iEanLC/pD32WFbpHamACID1lXqY0bOVlR0P+4c5M7Au5sEDGBbM1DUjQ9VS4zUsIO6O1PCLMNhENP/KHrA29M9Dp66A2hSfrBj+ed3Z5oF3QZtxeEkqI2x1dTiyFE/+xa+JTOnVPCA6Nts8Y1XQgU+OpUgO4fMDCfa+pF8gu3WM6JyQ85/LWEpvz7XRwN23NAM+rmllHbBKVKXQFzA==",
        ".cm80MkkyVEU1UENEZ0FJY+2UZXjit0JkOncknXIVVh2qt5/H9CahciPssIdAmVtR+0ny1u2fLzzmY42MpjSyvnWd+iIryEymzjGNzJRw1X+FRRQJ/Cq1Wx8m+Ff0jKe407A2wSOu9+mezBsQXCaPlLxKofVDU6K7WQ3hy8/475ib6vOPdnro3uChEpW5QmR/xnVXxt4DzzZIoFp2VjtyLF10z+wSRH5qtUGHOW0QGoK7Ql8lg/D29ZxEN1fVI17QCCRMAzcidU9y5GsmXHU8E7QzcpEpGqfVmFk5vedTXN0="
    ];

    console.log('🚀 Bắt đầu Debug API TKSieure với 2 Cookies...');

    try {
        // Mocking console.log của shopee.cjs để bắt được HTML nếu muốn hoặc sửa shopee.cjs tạm
        // Ở đây fetchOrdersBatch sẽ gọi và trả về mảng orders đã parse
        const orders = await fetchOrdersBatch(cookies);

        console.log('\n📊 KẾT QUẢ PARSE:');
        console.log(`Tìm thấy: ${orders.length} đơn hàng`);

        if (orders.length > 0) {
            orders.forEach((o, i) => {
                console.log(`${i + 1}. ID: ${o.id} | MVD: ${o.tracking_number} | Status: ${o.status}`);
            });
        } else {
            console.log('❌ KHÔNG CÓ ĐƠN NÀO ĐƯỢC PARSE.');
        }

    } catch (e) {
        console.error('❌ LỖI KHI GỌI API:', e.message);
    }
}

debugBatch();
