# 说明

基于[node-let-s-encrypt-aliyun-job](https://github.com/Relsoul/node-let-s-encrypt-aliyun-job) 感谢[@Relsoul](https://github.com/Relsoul)开发这个项目.作者的‘下一步规划’都快4年了还没更新。最近阿里云的免费证书又搞成了三个月一看阿里云cdn上几十个项目ssl临期心里就发慌，所以就基于作者的代码修改了一下，增加了自动清理阿里云上过期的上传证书的功能。

如果想做软件[来找我定制软件哟](https://www.zl771.cn/)

## 在原有的基础上修改了

1. 调用阿里云的接口来判断域名的ssl 是否临期，只有临期的才会上传
2. 自动清理阿里云上过期的上传证书
3. 使用x509来判断证书是否临期(原先是把日期写在config中)
4. 调整了一些代码逻辑
5. 复制conf-default.json 创建conf.json即可
6. 放到青龙面板上定时执行即可

## 配置参考

```(json)
{
  "confData": [
    {
      "name": "xxx域名",
      "ali": {
        "accessKeyId": "xxx",
        "accessKeySecret": "xxx",
        "domain": "xxx.com",
        "cdn": {
          "exclude": [
            "不希望更新的cdn域名"
          ]
        }
      },
      "contact": [
        "mailto:admin@zl771.cn"
      ],
      "identifiers": [
        "xxx.com",
        "*.xxx.com"
      ],
      "cName": "xxx.com"
    }
  ],
  "accountUrl": false,
  "contact": [
    "mailto:admin@zl771.cn"
  ],
  "sleepTime": 60000
}

```

## 目前这个功能满足了我的业务需求，所以我就不做更新了，如果需要更新，可以提issue，我会根据需求更新
