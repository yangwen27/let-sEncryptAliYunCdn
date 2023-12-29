const rq = require('request-promise');
const acme = require('acme-client');
const Core = require('@alicloud/pop-core');
const fs = require('fs-extra');
const path = require('path');
//const moment = require('moment');
// const nodessh = require('node-ssh');
const { Command } = require('commander');
const program = new Command();
const crypto = require("crypto") ;


const confList = require('./conf');
let accountPem;
try {
  accountPem = fs.readFileSync(path.join(__dirname, './account.pem'));
} catch (e) {
  console.warn(`account.pem不存在`)
}

if (accountPem) {
  accountPem = Buffer.from(accountPem);
}


// const ssh = new nodessh();
// program.version('0.0.1');

// program
//   .option('-alycdn', 'PUSH 证书至阿里云cdn', aliyCDN)
//   .option('-s', '开始域名配置', start)

// program.parse(process.argv);

function getAliClient (conf, endpoint = 'https://alidns.aliyuncs.com', apiVersion = '2015-01-09') {
  const aliClient = new Core({
    accessKeyId: conf.ali.accessKeyId,
    accessKeySecret: conf.ali.accessKeySecret,
    endpoint: endpoint,
    apiVersion: apiVersion
  });
  return aliClient
}
async function run (conf) {
  console.log('开始执行配置文件为:', conf.name);

  async function getDomainRecordList () {
    var params = {
      "DomainName": conf.ali.domain,
      "PageSize": 500
    };
    var requestOption = {
      method: 'GET'
    };
    return aliClient.request('DescribeDomainRecords', params, requestOption)

  }

  async function setAliDns (value) {
    let domainRecordListRes = await getDomainRecordList();
    domainRecordListRes = domainRecordListRes;
    const list = domainRecordListRes.DomainRecords.Record;
    // 找到是否有记录为_acme-challenge
    const find = list.find((n) => {
      return n.RR == '_acme-challenge';
    });

    if (find) {
      // 修改解析记录
      if (find.Value == value) {
        console.log('当前域名DNS解析记录值与验证值一致', value);
        return Promise.resolve(true);
      }
      await changeAcmeDomainRecore(find.RecordId, value)
    } else {
      // 添加解析记录
      await addAcmeDomainRecord(value)
    }
  }

  function timeSleep (time) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(true)
      }, time)
    })
  }


  async function addAcmeDomainRecord (value) {
    var params = {
      "DomainName": conf.ali.domain,
      "RR": "_acme-challenge",
      "Type": "TXT",
      "Value": value
    };
    var requestOption = {
      method: 'POST'
    };
    return aliClient.request('AddDomainRecord', params, requestOption)
  }

  async function changeAcmeDomainRecore (recordId, value) {
    var params = {
      "DomainName": conf.ali.domain,
      "RecordId": recordId,
      "RR": "_acme-challenge",
      "Type": "TXT",
      "Value": value
    };
    var requestOption = {
      method: 'POST'
    };
    return aliClient.request('UpdateDomainRecord', params, requestOption)
  }

  const aliClient = getAliClient(conf)

  let privateKey, client, account, accountUrl;
  let clientObj = {
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: accountPem,
  }
  if (!accountPem || !confList.accountUrl) {
    privateKey = await acme.forge.createPrivateKey();
    accountPem = privateKey;
    await fs.writeFile(path.join(__dirname, './account.pem'), accountPem);

    console.log('初始化客户端');
    clientObj.accountKey = accountPem;
    client = new acme.Client(clientObj);

    console.log('创建账号');
    account = await client.createAccount({
      termsOfServiceAgreed: true,
      contact: confList.contact
    });


    console.log('获取账号url');
    accountUrl = await client.getAccountUrl();
    // 写入accountUrl
    confList.accountUrl = accountUrl;
    await fs.writeJson('./conf.json', confList, { spaces: 2 });
    console.log('写入账号url成功')
  } else {
    console.log('拥有账号，开始初始化客户端');
    clientObj.accountUrl = confList.accountUrl;
    client = new acme.Client(clientObj);
  }

  // 拼装identi
  const identifiers = conf.identifiers.map((n) => {
    return { type: 'dns', value: n }
  });
  const order = await client.createOrder({
    wildcard: true,
    identifiers: identifiers,
  });
  console.log('order', order);

  // 从订单获取授权
  const auth = await client.getAuthorizations(order);

  console.log('auth', auth);

  // 获取授权列表
  const challengeList = [];
  for (let i of auth) {
    // 获取授权challenge
    // 找到DNS授权类型的challenge
    const dnsChallenge = i.challenges.find((n) => {
      return n.type == 'dns-01'
    })
    const challenge = await client.getChallengeKeyAuthorization(dnsChallenge);
    console.log('challenge', challenge);
    challengeList.push(challenge)
  }

  let index = -1;
  for (let i of auth) {
    // 验证challenge
    let userAuth;
    const dnsChallenge = i.challenges.find((n) => {
      return n.type == 'dns-01';
    });
    index++;
    console.log('开始设置', challengeList[index])
    await setAliDns(challengeList[index]);
    await timeSleep(60000);
    let trycount = 1;
    let succ = false
    while (trycount <= 3 && succ == false) {
      console.log('开始验证！', challengeList[index])
      try {
        userAuth = await client.verifyChallenge(i, dnsChallenge);
        succ = true;
        break;
      } catch (e) {
        // 验证失败
        console.error('userAuth Error', e);
        succ = false;
        trycount++;
        // 1分钟后进行验证
        await timeSleep(confList.sleepTime);
      }
    }
    if (succ == false) {
      return false;
    }
    // 通知acme授权完成
    let authComplete, waitStatus;
    try {
      authComplete = await client.completeChallenge(dnsChallenge);
      waitStatus = await client.waitForValidStatus(dnsChallenge);
    } catch (e) {
      console.error('通知acme授权完成失败 ---err', e);
      return
    }
    console.log('验证成功:', auth.indexOf(i), dnsChallenge)
  }

  let certificateKey, certificateCsr;
  try {
    [certificateKey, certificateCsr] = await acme.forge.createCsr({
      commonName: conf.cName,
      altNames: conf.identifiers
    });
  } catch (e) {
    console.error('获取certificateKey&certificateCsr失败', e);
    return false;
  }
  // 最终确定订单
  let fOrder;
  try {
    fOrder = await client.finalizeOrder(order, certificateCsr);
  } catch (e) {
    console.error('获取fOrder失败', e);
    // return false;
  }
  console.log('fOrder', fOrder);
  // 获取证书值
  let cert;
  try {
    cert = await client.getCertificate(order);
  } catch (e) {
    console.error('获取cert失败', e);
    return false;
  }
  console.log('cert', cert);

  // 私钥为certificateKey 公钥为cert

  // 写入本地
  const pemPath = path.join(__dirname, `./cert/${conf.cName}-public.pem`);
  await fs.outputFile(pemPath, cert);
  const privPath = path.join(__dirname, `./cert/${conf.cName}-private.pem`);
  await fs.outputFile(privPath, certificateKey);

  // 通过sftp上传线上
  // if (conf.sftp) {
  //   await ssh.connect(conf.sftp);
  //   const pemRes = await ssh.putFile(pemPath, `${conf.sftp.uploadPath}/${conf.cName}-public.pem`);
  //   console.log('上传sftp成功', pemRes);
  //   const privateRes = await ssh.putFile(privPath, `${conf.sftp.uploadPath}/${conf.cName}-private.pem`);
  //   console.log('上传private成功', privateRes);
  //   // 执行execShell
  //   const execRes = await ssh.execCommand(conf.sftp.execShell, { cwd: '/' });
  //   console.log('执行exec命令', execRes);
  // }
  return Promise.resolve(true);
}

async function start () {
  for (let i of confList.confData) {
    let validTo = 0
    let cert;
    try {
       cert = new crypto.X509Certificate(fs.readFileSync(path.join(__dirname, `./cert/${i.cName}-public.pem`)));
      validTo = new Date(cert.validTo).getTime()
    } catch (_) {
      console.log('首次运行')
      validTo = 0
    }
    let now=Date.now()
    if (validTo - now <1000*60*60*24*10){
      await run(i);
      console.log(`${i.name}更新完毕`);
    }else{
      console.log(`${i.name}过期时间是${cert && new Date(cert.validTo).toLocaleString() },有效期大于10天不处理`);
    }
    console.log('下面开始检索更新阿里云CDN证书');
    await aliyCDN(i)
  }
  console.log('全部配置文件更新完毕');
//  process.exit();
}

async function aliyCDN (conf) {
  if (conf.ali && conf.ali.cdn) {
    const aliClient = getAliClient(conf, 'https://cdn.aliyuncs.com', '2018-05-10')
    const currentCdn = conf.ali.cdn;
    async function getAliCdnList () {
      var params = {
        "PageSize": 50,
      };
      var requestOption = {
        method: 'POST'
      };
      return aliClient.request('DescribeUserDomains', params, requestOption)
    }
    async function setAliCdnHostSSL ({ name, ServerCertificate, PrivateKey }) {
      var params = {
        "DomainName": name,
        //"CertName": name + Date.now(), 不填会自动生成，避免了证书名称已存在的错误
        "SSLProtocol": 'on',
        "CertType": 'upload',
        "SSLPub": ServerCertificate,
        "SSLPri": PrivateKey,
      };
      var requestOption = {
        method: 'POST'
      };
      return aliClient.request('SetCdnDomainSSLCertificate', params, requestOption)
    }
    async function removeExpired () {
      //证书列表太难看了，把过期的给删了。
      const aliClient2 = getAliClient(conf, 'https://cas.aliyuncs.com', '2020-04-07')
      var params = {
        status: "EXPIRED",
        orderType: "UPLOAD",
      };
      var requestOption = {
        method: 'POST'
      };
      let data = await aliClient2.request('ListUserCertificateOrder', params, requestOption)
      console.log('过期的域名数量', data.TotalCount)
      if (data.TotalCount > 0) {
        for (let i = 0; i < data.CertificateOrderList.length; i++) {
          const order = data.CertificateOrderList[i]
          const params2 = {
            CertId: order.CertificateId,
          };
          var requestOption2 = {
            method: 'POST'
          };
          try {
            await aliClient2.request('DeleteUserCertificate', params2, requestOption2)
          } catch (error) {
            console.log(error)
          }
        }
      }
    }
    async function getDomainInfo (domain) {
      var params = {
        DomainName: domain,
      };
      var requestOption = {
        method: 'POST'
      };
      try {
        let data = await aliClient.request('DescribeDomainCertificateInfo', params, requestOption)
        return data.CertInfos.CertInfo
      } catch (error) {
        console.error('获取证书失败', error)
        return []
      }
    }
    const cdnList = await getAliCdnList()
    let listDomain = cdnList.Domains.PageData.filter(i => currentCdn.exclude.indexOf(i.DomainName) === -1 && i.DomainName.endsWith(conf.cName) && i.SslProtocol === 'on' && i.DomainStatus === 'online')
    let isAll = conf.identifiers.indexOf('*.' + conf.cName) >= 0//泛域名
    try {
      console.log('删除过期的证书')
      await removeExpired()
    } catch (error) {
      console.log('删除过期失败', error)
    }
    const pemPath = path.join(__dirname, `./cert/${conf.cName}-public.pem`);
    const privPath = path.join(__dirname, `./cert/${conf.cName}-private.pem`);
    try {
      await fs.ensureFile(pemPath)
      await fs.ensureFile(privPath)
    } catch (err) {
      console.error(conf.cName, '私钥公钥文件不存在', err)
      return false;
    }
    const ServerCertificate = await fs.readFile(pemPath)
    const PrivateKey = await fs.readFile(privPath)
    for (let i of listDomain) {
      if (isAll === false && conf.identifiers.indexOf(i.DomainName) === -1) {
        console.warn('证书不包含泛域名，也不包含当前域名跳过', i.DomainName)
        continue
      }
      let info = await getDomainInfo(i.DomainName)
      if (info[0]) {
        let expiredAt = new Date(info[0].CertExpireTime).getTime()
        let now = new Date().getTime()
        let diff = expiredAt - now
        if (diff <= 60 * 60 * 24 * 10) {
          console.log('证书即将过期', i.DomainName, info[0].CertExpireTime)
          let setRes;
          try {
            setRes = await setAliCdnHostSSL({ name: i.DomainName, ServerCertificate, PrivateKey })
          } catch (e) {
            console.error(i.DomainName, '设置域名SSL出错', e)
          }
          console.log('设置cdn域名成功', i.DomainName, setRes)
        } else {
          console.log(`${i.DomainName} 过期时间是：${info[0].CertExpireTime},无需更新`);
        }
      }
    }
  }
  console.log('全部配置文件CDN域名信息更新完毕，请手动操作控制台配置CDN 如已配置请忽略');
  // process.exit();
}
// process.on('unhandledRejection', (p) => {
//   // console.error('unhandledRejection', p);
//   console.trace('unhandledRejection', p);
// });// 全局监听未处理的promise错误

// process.on('uncaughtException', function (err) {
//   // console.error('uncaughtException', err);
//   console.trace('uncaughtException', err);
// });

// 测试环境
// https://acme-staging-v02.api.letsencrypt.org/directory

start()