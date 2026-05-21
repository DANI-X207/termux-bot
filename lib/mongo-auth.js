const {
    proto,
    BufferJSON,
    initAuthCreds
} = require('@whiskeysockets/baileys');

/**
 * Custom MongoDB Auth State for Baileys
 */
module.exports = function useMongoDBAuthState(collection) {
    const writeData = async (data, id) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await collection.updateOne(
            { _id: id },
            { $set: { data: json } },
            { upsert: true }
        );
    };

    const readData = async (id) => {
        try {
            const document = await collection.findOne({ _id: id });
            if (document) {
                return JSON.parse(document.data, BufferJSON.reviver);
            }
        } catch (error) {
            console.error('Error reading data from MongoDB:', error);
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: id });
        } catch (error) {
            console.error('Error removing data from MongoDB:', error);
        }
    };

    const state = {
        creds: null,
        keys: {
            get: async (type, ids) => {
                const data = {};
                await Promise.all(
                    ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    })
                );
                return data;
            },
            set: async (data) => {
                const tasks = [];
                for (const category in data) {
                    for (const id in data[category]) {
                        const value = data[category][id];
                        const key = `${category}-${id}`;
                        tasks.push(value ? writeData(value, key) : removeData(key));
                    }
                }
                await Promise.all(tasks);
            }
        }
    };

    return {
        state,
        saveCreds: async () => {
            await writeData(state.creds, 'creds');
        },
        init: async () => {
            state.creds = await readData('creds') || initAuthCreds();
        }
    };
};
