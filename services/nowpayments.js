const axios = require('axios');

class NOWPayments {
    constructor() {
        this.apiKey = process.env.NOWPAYMENTS_API_KEY;
        this.baseURL = 'https://api.nowpayments.io/v1';
    }

    async createPayment(amount, orderId, username) {
        try {
            const response = await axios.post(`${this.baseURL}/payment`, {
                price_amount: amount,
                price_currency: 'usd',
                pay_currency: 'usdttrc20',
                order_id: orderId,
                order_description: `${username} - Buy ${amount} credits`,
                ipn_callback_url: `${process.env.BASE_URL}/api/payment/webhook`
            }, {
                headers: {
                    'x-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            return response.data;
        } catch (error) {
            console.error('NOWPayments create error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || 'Payment creation failed');
        }
    }

    async getPaymentStatus(paymentId) {
        try {
            const response = await axios.get(`${this.baseURL}/payment/${paymentId}`, {
                headers: {
                    'x-api-key': this.apiKey
                }
            });

            return response.data;
        } catch (error) {
            console.error('Status check error:', error.response?.data || error.message);
            throw new Error('Failed to check payment status');
        }
    }

    async getMinimumAmount(currency = 'usdttrc20') {
        try {
            const response = await axios.get(`${this.baseURL}/min-amount`, {
                params: {
                    currency_from: 'usd',
                    currency_to: currency
                },
                headers: {
                    'x-api-key': this.apiKey
                }
            });

            return response.data;
        } catch (error) {
            console.error('Min amount error:', error);
            return null;
        }
    }
}

module.exports = new NOWPayments();
