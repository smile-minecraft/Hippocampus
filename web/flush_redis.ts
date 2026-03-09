import Redis from 'ioredis'; new Redis().flushall().then(()=>process.exit(0));
