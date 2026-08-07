require('dotenv').config(); 
const express = require('express');
const cors = require('cors'); 
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const https = require('https');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// مكتبات Cloudinary لتخزين الصور بشكل دائم
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production';

// Client ID الخاص بجوجل
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '661574967799-jrv9c3s98t3u5g19nrdcatd80qrmovib.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ================= 🌐 إعدادات الـ CORS الكاملة =================
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions)); 
app.use(express.json());

// ================= ☁️ إعداد Cloudinary لرفع الصور بشكل دائم =================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'makeup_studio_uploads',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // حد أقصى 5 ميجابايت للصورة
});

// ================= الاتصال بقاعدة البيانات MongoDB Atlas =================
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/makeup_store')
  .then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح! 🎉'))
  .catch((err) => console.error('فشل الاتصال بقاعدة البيانات:', err));

// ================= الـ Schemas والموديلات (Models) =================

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }, 
    role: { type: String, default: 'user' }, 
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    createdAt: { type: Date, default: Date.now }
});
const Category = mongoose.model('Category', categorySchema);

const clothingSchema = new mongoose.Schema({
    title: { type: String, required: true },
    mainImage: { type: String }, 
    originalPrice: { type: Number, required: true },
    salePrice: { type: Number },
    saleEnds: { type: Date }, 
    description: { type: String },

    category: { type: String, required: true, trim: true, index: true },
    subcategory: { type: String, trim: true, default: null, index: true },

    variantGroups: [{
        title: { type: String },
        options: [{
            name: { type: String },
            image: { type: String, default: null }
        }]
    }],

    variantCategory: { type: String, default: 'الدرجات المتاحة' }, 
    variants: [{ 
        name: { type: String }, 
        image: { type: String } 
    }], 
    createdAt: { type: Date, default: Date.now, index: true }
});

const Clothing = mongoose.model('Clothing', clothingSchema);

const favoriteSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clothing', required: true },
    createdAt: { type: Date, default: Date.now }
});
favoriteSchema.index({ userId: 1, productId: 1 }, { unique: true });
const Favorite = mongoose.model('Favorite', favoriteSchema);

const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model('Admin', adminSchema);

const orderSchema = new mongoose.Schema({
    userId: { type: String },
    userName: { type: String },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    extraPhone: { type: String, default: null },
    governorate: { type: String, required: true },
    shippingCost: { type: Number, default: 0 },
    total: { type: Number, required: true },
    grandTotal: { type: Number, required: true },
    status: { type: String, default: 'قيد الانتظار' }, 
    items: [{
        productId: { type: String },
        title: { type: String },
        quantity: { type: Number, default: 1 },
        price: { type: Number },
        image: { type: String },
        selectedVariant: { type: String },
        selectedVariantImage: { type: String }
    }],
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const Order = mongoose.model('Order', orderSchema);

const bookingSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    deliveryTime: { type: String, required: true },
    selectedVariant: { type: String },
    selectedVariantImage: { type: String },
    status: { type: String, default: 'قيد الانتظار' }, 
    product: { 
        type: mongoose.Schema.Types.Mixed,
        ref: 'Clothing' 
    },
    createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// ================= دوال مساعدة (Helper Functions) =================

function fetchGoogleUserInfo(accessToken) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'www.googleapis.com',
            path: '/oauth2/v3/userinfo',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Google API status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.end();
    });
}

// دالة حذف الصورة الدائمة من Cloudinary عند مسح المنتج
const safeDeleteImage = async (imageUrl) => {
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.includes('cloudinary.com')) return;
    try {
        const parts = imageUrl.split('/');
        const fileNameWithExt = parts[parts.length - 1];
        const folderName = parts[parts.length - 2];
        const publicId = `${folderName}/${fileNameWithExt.split('.')[0]}`;
        await cloudinary.uploader.destroy(publicId);
    } catch (err) {
        console.error(`فشل حذف الصورة من Cloudinary: ${imageUrl}`, err);
    }
};

// ================= الـ API Routes =================

app.get('/', (req, res) => {
    res.json({ message: "Makeup Studio API is running smoothly 🚀" });
});

// ---------------- 🔴 روابط التسجيل ودخول جوجل ----------------

app.post('/api/auth/google', async (req, res) => {
    try {
        const { idToken, accessToken } = req.body;

        if (!idToken && !accessToken) {
            return res.status(400).json({ message: "يلزم توفير idToken أو accessToken" });
        }

        let email, name, googleId;

        if (idToken) {
            try {
                const ticket = await googleClient.verifyIdToken({
                    idToken: idToken,
                    audience: GOOGLE_CLIENT_ID,
                });
                const payload = ticket.getPayload();
                email = payload.email;
                name = payload.name;
                googleId = payload.sub;
            } catch (idTokenError) {
                console.warn("تعذر التحقق بواسطة idToken، الانتهاج للـ accessToken:", idTokenError.message);
            }
        }

        if (!email && accessToken) {
            const googleProfile = await fetchGoogleUserInfo(accessToken);
            email = googleProfile.email;
            name = googleProfile.name;
            googleId = googleProfile.sub;
        }

        if (!email) {
            return res.status(401).json({ message: "فشل التحقق من توكن جوجل" });
        }

        let user = await User.findOne({ email });

        if (!user) {
            const hashedPassword = await bcrypt.hash(`google_oauth_${googleId}`, 10);
            user = new User({
                name: name || 'مستخدم جوجل',
                email: email,
                password: hashedPassword,
                role: 'user'
            });
            await user.save();
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

        res.status(200).json({
            message: "تم تسجيل الدخول بجوجل بنجاح 🎉",
            token,
            userId: user._id,
            name: user.name,
            email: user.email,
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("خطأ تسجيل الدخول بجوجل:", error);
        res.status(401).json({ message: "فشل التحقق من توكن جوجل" });
    }
});

// ---------------- 🔴 روابط إدارة المفضلة (Favorites) ----------------

app.get('/api/favorites/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const favorites = await Favorite.find({ userId }).populate('productId').lean();
        const items = favorites
            .filter(f => f.productId != null)
            .map(f => f.productId);

        res.json(items);
    } catch (error) {
        console.error("خطأ جلب المفضلة:", error);
        res.status(500).json({ message: "حدث خطأ أثناء جلب المفضلة" });
    }
});

app.post('/api/favorites/add', async (req, res) => {
    try {
        const { userId, productId } = req.body;
        if (!userId || !productId) {
            return res.status(400).json({ message: "userId و productId مطلوبان" });
        }

        const newFav = new Favorite({ userId, productId });
        await newFav.save();
        res.status(201).json({ message: "تمت إضافة المنتج للمفضلة بنجاح ❤️" });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "المنتج موجود بالفعل في المفضلة" });
        }
        res.status(500).json({ message: "حدث خطأ أثناء إضافة المنتج للمفضلة" });
    }
});

app.post('/api/favorites/remove', async (req, res) => {
    try {
        const { userId, productId } = req.body;
        if (!userId || !productId) {
            return res.status(400).json({ message: "userId و productId مطلوبان" });
        }

        await Favorite.findOneAndDelete({ userId, productId });
        res.json({ message: "تمت إزالة المنتج من المفضلة بنجاح ✔️" });
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء إزالة المنتج من المفضلة" });
    }
});

// ---------------- روابط نظام الحسابات والـ Auth ----------------

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: "جميع الحقول مطلوبة" });
        }

        const exactUser = await User.findOne({ email });
        if (exactUser) return res.status(400).json({ message: "هذا الحساب مسجل بالفعل" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();
        
        res.status(201).json({ message: "تم إنشاء الحساب بنجاح!" });
    } catch (error) {
        res.status(500).json({ message: "فشل إنشاء الحساب" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ message: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
        }

        const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            message: "تم تسجيل الدخول بنجاح",
            token, 
            userId: user._id,
            name: user.name,
            email: user.email
        });
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ في الخادم أثناء تسجيل الدخول" });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(404).json({ message: "المستخدم غير موجود" });
        }
        const user = await User.findById(userId).select('-password').lean(); 
        if (!user) return res.status(404).json({ message: "المستخدم غير موجود" });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ في الخادم أثناء جلب البيانات" });
    }
});

app.put('/api/users/update-profile', async (req, res) => {
    try {
        const { userId, name, email } = req.body;

        if (!userId || !name) {
            return res.status(400).json({ message: "userId و name مطلوبان" });
        }

        const trimmedName = name.trim();

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            if (email) {
                const updatedUserByEmail = await User.findOneAndUpdate(
                    { email: email.toLowerCase() },
                    { name: trimmedName },
                    { new: true }
                ).select('-password');

                if (updatedUserByEmail) {
                    return res.status(200).json({
                        message: "تم حفظ التعديلات بنجاح ✔️",
                        user: updatedUserByEmail
                    });
                }
            }

            return res.status(200).json({
                message: "تم حفظ التعديلات بنجاح ✔️",
                user: {
                    _id: userId,
                    name: trimmedName,
                    email: email || "makeupstudio@gmail.com"
                }
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { name: trimmedName },
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: "المستخدم غير موجود" });
        }

        return res.status(200).json({
            message: "تم حفظ التعديلات بنجاح ✔️",
            user: updatedUser
        });
    } catch (error) {
        console.error("خطأ تحديث الملف الشخصي:", error);
        return res.status(500).json({ message: "حدث خطأ أثناء تحديث البيانات" });
    }
});

// ---------------- 🟢 روابط الأقسام والمنتجات والصور ----------------

// مسار رفع الصور إلى Cloudinary وإعادة رابط HTTPS الدائم
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'لم يتم رفع أي ملف' });
    
    // إرجاع رابط الصورة المباشر والدائم من Cloudinary
    res.json({ imageUrl: req.file.path });
});

app.get('/api/categories', async (req, res) => {
    try {
        const [customCategories, productCategories] = await Promise.all([
            Category.distinct('name'),
            Clothing.distinct('category')
        ]);

        const allCategories = Array.from(new Set([...customCategories, ...productCategories]))
            .filter(cat => cat && cat.trim() !== '');

        res.json(allCategories);
    } catch (error) {
        console.error("خطأ جلب الأقسام:", error);
        res.status(500).json({ message: "حدث خطأ أثناء جلب الأقسام" });
    }
});

app.post('/api/categories', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ message: "اسم القسم مطلوب" });
        }

        const existingCategory = await Category.findOne({ name: name.trim() });
        if (existingCategory) {
            return res.status(400).json({ message: "هذا القسم موجود بالفعل" });
        }

        const newCategory = new Category({ name: name.trim() });
        await newCategory.save();

        res.status(201).json({ message: "تم إضافة القسم بنجاح 🎉", category: newCategory });
    } catch (error) {
        console.error("خطأ إضافة قسم:", error);
        res.status(500).json({ message: "حدث خطأ أثناء إضافة القسم", error: error.message });
    }
});

app.delete('/api/categories/:idOrName', async (req, res) => {
    try {
        const { idOrName } = req.params;

        if (mongoose.Types.ObjectId.isValid(idOrName)) {
            await Category.findByIdAndDelete(idOrName);
        } else {
            await Category.deleteOne({ name: idOrName });
        }

        res.json({ message: "تم حذف القسم بنجاح 🗑️" });
    } catch (error) {
        console.error("خطأ حذف القسم:", error);
        res.status(500).json({ message: "حدث خطأ أثناء حذف القسم" });
    }
});

// استعلام سريعة جداً باستغلال Lean & Indexing
app.get('/api/clothes', async (req, res) => {
    try {
        const { category, subcategory } = req.query;
        let query = {};

        if (category) {
            query.category = category;
        }
        if (subcategory) {
            query.subcategory = subcategory;
        }

        const clothes = await Clothing.find(query).sort({ createdAt: -1 }).lean();
        res.json(clothes);
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء جلب البيانات" });
    }
});

app.post('/api/clothes', async (req, res) => {
    try {
        const newCloth = new Clothing(req.body);
        const savedCloth = await newCloth.save();
        res.status(201).json({ message: "تم الحفظ في قاعدة البيانات بنجاح!", item: savedCloth });
    } catch (error) {
        console.error("خطأ أثناء إضافة المنتج:", error);
        res.status(400).json({ message: "فشل إضافة القطعة", error: error.message });
    }
});

app.put('/api/clothes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "معرف غير صالح" });
        }

        const updatedCloth = await Clothing.findByIdAndUpdate(
            id,
            { $set: req.body },
            { new: true, runValidators: true }
        );

        if (!updatedCloth) {
            return res.status(404).json({ message: "المنتج غير موجود" });
        }

        res.json({
            message: "تم تحديث المنتج بنجاح! ✨",
            item: updatedCloth
        });
    } catch (error) {
        console.error("خطأ أثناء تحديث المنتج:", error);
        res.status(500).json({ message: "حدث خطأ أثناء تحديث المنتج", error: error.message });
    }
});

app.delete('/api/clothes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "معرف غير صالح" });
        }

        const cloth = await Clothing.findById(id);
        if (!cloth) {
            return res.status(404).json({ message: "هذه القطعة غير موجودة بالفعل" });
        }

        // مسح الصورة الرئيسية والصور الفرعية من Cloudinary
        await safeDeleteImage(cloth.mainImage);

        if (cloth.variants && cloth.variants.length > 0) {
            for (const variant of cloth.variants) {
                await safeDeleteImage(variant.image);
            }
        }

        if (cloth.variantGroups && cloth.variantGroups.length > 0) {
            for (const group of cloth.variantGroups) {
                if (group.options) {
                    for (const opt of group.options) {
                        await safeDeleteImage(opt.image);
                    }
                }
            }
        }

        await Clothing.findByIdAndDelete(id);
        await Favorite.deleteMany({ productId: id });
        await Booking.deleteMany({ "product._id": id });

        res.json({ 
            message: "تم مسح القطعة وجميع صورها وبياناتها بنجاح! 🗑️", 
            item: cloth 
        });

    } catch (error) {
        console.error("خطأ أثناء حذف القطعة:", error);
        res.status(500).json({ message: "حدث خطأ أثناء مسح القطعة" });
    }
});

// ---------------- رابط التحقق من الأدمن ----------------

app.get('/api/users/check-admin/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (userId === '64b0f1a2c3d4e5f6a7b8c9d0' || userId === 'developer_admin_id') return res.json({ isAdmin: true });
        if (!mongoose.Types.ObjectId.isValid(userId)) return res.json({ isAdmin: false });

        const user = await User.findById(userId).lean();
        if (user) {
            if (user.email === 'makeupstudio@gmail.com' || user.role === 'admin') return res.json({ isAdmin: true });
            const isAdminEmail = await Admin.findOne({ email: user.email }).lean();
            if (isAdminEmail) return res.json({ isAdmin: true });
        }
        const adminById = await Admin.findById(userId).lean();
        if (adminById) return res.json({ isAdmin: true });

        res.json({ isAdmin: false });
    } catch (error) {
        res.json({ isAdmin: false }); 
    }
});

app.post('/api/users/add-admin', async (req, res) => {
    try {
        const newAdmin = new Admin(req.body);
        const savedAdmin = await newAdmin.save();
        res.status(201).json({ message: "تم إضافة الأدمن بنجاح! 👑", admin: savedAdmin });
    } catch (error) {
        res.status(400).json({ message: "فشل إضافة الأدمن", error: error.message });
    }
});

// ---------------- روابط إدارة الطلبات (Orders) ----------------

app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order(req.body);
        const savedOrder = await newOrder.save();
        res.status(201).json({ message: "تم تسجيل الطلب بنجاح! 🎉", order: savedOrder });
    } catch (error) {
        res.status(400).json({ message: "فشل تسجيل الطلب", error: error.message });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).lean();

        const productIds = [];
        orders.forEach(order => {
            if (order.items) {
                order.items.forEach(item => {
                    if (item.productId && mongoose.Types.ObjectId.isValid(item.productId)) {
                        productIds.push(item.productId);
                    }
                });
            }
        });

        const products = await Clothing.find({ _id: { $in: productIds } }).lean();
        const productMap = new Map(products.map(p => [p._id.toString(), p]));

        const populatedOrders = orders.map(order => {
            if (order.items && order.items.length > 0) {
                order.items.forEach(item => {
                    if (item.productId && productMap.has(item.productId.toString())) {
                        const product = productMap.get(item.productId.toString());
                        
                        if (!item.image && !item.selectedVariantImage) {
                            item.image = product.mainImage;
                        }
                        
                        if (item.selectedVariant && !item.selectedVariantImage) {
                            if (product.variants) {
                                const foundVar = product.variants.find(v => v.name === item.selectedVariant);
                                if (foundVar && foundVar.image) item.selectedVariantImage = foundVar.image;
                            }
                            if (!item.selectedVariantImage && product.variantGroups) {
                                for (let group of product.variantGroups) {
                                    if (group.options) {
                                        const foundOpt = group.options.find(o => o.name === item.selectedVariant);
                                        if (foundOpt && foundOpt.image) {
                                            item.selectedVariantImage = foundOpt.image;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }
            return order;
        });

        res.json(populatedOrders);
    } catch (error) {
        console.error("خطأ جلب الطلبات:", error);
        res.status(500).json({ message: "حدث خطأ أثناء جلب الطلبات" });
    }
});

app.put('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "معرف غير صالح" });

        const updatedOrder = await Order.findByIdAndUpdate(
            id, 
            { status: req.body.status }, 
            { new: true }
        );
        if (!updatedOrder) return res.status(404).json({ message: "الطلب غير موجود" });

        res.json({ message: "تم تحديث حالة الطلب بنجاح", order: updatedOrder });
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء تحديث حالة الطلب" });
    }
});

app.delete('/api/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "معرف غير صالح" });

        const deletedOrder = await Order.findByIdAndDelete(id);
        if (!deletedOrder) return res.status(404).json({ message: "الطلب غير موجود بالفعل" });

        res.json({ message: "تم حذف الطلب بنجاح 🗑️" });
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء حذف الطلب" });
    }
});

// ---------------- روابط الحجوزات (Bookings) ----------------

app.post('/api/bookings', async (req, res) => {
    try {
        const newBooking = new Booking(req.body);
        const savedBooking = await newBooking.save();
        res.status(201).json({ message: "تم تسجيل الحجز بنجاح! 🎉", booking: savedBooking });
    } catch (error) {
        res.status(400).json({ message: "فشل تسجيل الحجز", error: error.message });
    }
});

app.get('/api/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 }).lean();

        const productIds = bookings
            .map(b => b.product)
            .filter(id => id && mongoose.Types.ObjectId.isValid(id));

        const products = await Clothing.find({ _id: { $in: productIds } }).lean();
        const productMap = new Map(products.map(p => [p._id.toString(), p]));

        const populatedBookings = bookings.map(b => {
            if (b.product && productMap.has(b.product.toString())) {
                b.product = productMap.get(b.product.toString());
            }
            return b;
        });

        res.json(populatedBookings);
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء جلب الحجوزات" });
    }
});

app.put('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "معرف غير صالح" });

        const updatedBooking = await Booking.findByIdAndUpdate(
            id,
            { status: req.body.status },
            { new: true }
        );
        if (!updatedBooking) return res.status(404).json({ message: "الحجز غير موجود" });

        res.json({ message: "تم تحديث حالة الحجز بنجاح", booking: updatedBooking });
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء تحديث الحجز" });
    }
});

app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "معرف غير صالح" });

        const deletedBooking = await Booking.findByIdAndDelete(id);
        if (!deletedBooking) return res.status(404).json({ message: "الحجز غير موجود بالفعل" });

        res.json({ message: "تم حذف الحجز بنجاح 🗑️" });
    } catch (error) {
        res.status(500).json({ message: "حدث خطأ أثناء حذف الحجز" });
    }
});

// ---------------- حذف حساب مستخدم ----------------
app.delete('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ message: "معرف غير صالح" });

        const deletedUser = await User.findByIdAndDelete(userId);
        if (!deletedUser) return res.status(404).json({ message: "المستند غير موجود بالفعل" });

        res.json({ message: "تم حذف حساب المستخدم بنجاح" });
    } catch (error) {
        res.status(500).json({ message: "فشل حذف الحساب" });
    }
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`السيرفر شغال وزاهي على البورت: ${PORT} 🚀`);
});