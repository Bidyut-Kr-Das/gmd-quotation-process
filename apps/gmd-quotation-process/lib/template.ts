const pdftemplate = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Offer Letter</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    margin: 0;
    padding: 20px;
    background: #e8e8e8;
    color: #7a1f1f;
  }
  .page {
    max-width: 900px;
    margin: 0 auto;
    background: #fff;
    border: 2px solid #7a1f1f;
  }
  /* Header */
  .header {
    background: #5a0f0f;
    color: #fff;
    padding: 8px 15px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header .left { font-size: 11px; line-height: 1.5; }
  .header .left .bold { font-weight: bold; }
  .header .logo {
    background: #fff;
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 140px;
  }
  .header .logo .brand {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 26px;
    font-weight: bold;
    color: #5a0f0f;
    letter-spacing: 1px;
  }
  .header .logo .tag {
    font-size: 8px;
    color: #5a0f0f;
    letter-spacing: 1px;
    margin-top: 2px;
  }

  /* Offer No bar */
  .offerno {
    background: #5a0f0f;
    color: #fff;
    padding: 6px 15px;
    font-size: 12px;
    font-weight: bold;
  }
  .offerno span.val {
    color: #f4a460;
    margin-left: 10px;
  }

  .content { padding: 10px 15px; font-size: 12px; }
  .content p { margin: 6px 0; }
  .to-label { font-weight: bold; margin: 8px 0 2px 0; }
  .company-name { margin: 0 0 8px 0; }

  .sub-bar {
    background: #5a0f0f;
    color: #fff;
    padding: 6px 15px;
    font-size: 12px;
    font-weight: bold;
    display: flex;
    justify-content: space-between;
    margin: 0 -15px;
  }

  .sub-text {
    font-weight: bold;
    padding: 6px 0 0 0;
  }

  .terms-title {
    font-weight: bold;
    text-decoration: underline;
    margin-top: 14px;
  }
  .terms-list { margin: 6px 0; }
  .terms-list .row {
    display: flex;
    margin: 3px 0;
  }
  .terms-list .label {
    font-weight: bold;
    text-decoration: underline;
    width: 140px;
    flex-shrink: 0;
  }
  .terms-list .value {
    color: #000;
  }

  .signoff { margin-top: 18px; }
  .signoff p { margin: 3px 0; }
  .signoff .thanks { font-weight: bold; }
  .signoff .for-company { font-weight: bold; }
  .signoff .name { font-weight: bold; }

  .enclosed-row {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }
  .enclosed-row .label { font-weight: bold; text-decoration: underline; }
  .enclosed-row .value { font-weight: bold; text-decoration: underline; }

  .annexure-title {
    text-align: center;
    background: #fff;
    color: #5a0f0f;
    font-weight: bold;
    padding: 10px 0;
    border-top: 2px solid #7a1f1f;
    border-bottom: 2px solid #7a1f1f;
    margin-top: 10px;
  }

  table.price-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  table.price-table th {
    background: #fff;
    color: #5a0f0f;
    border: 1px solid #7a1f1f;
    padding: 6px 4px;
    font-weight: bold;
  }
  table.price-table td {
    border: 1px solid #7a1f1f;
    padding: 6px 4px;
    color: #000;
    text-align: center;
  }
  table.price-table td.item-name {
    text-align: left;
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="left">
      <div><span class="bold">Head Office :</span> Adventz Infinity@ 5, BN Block, 19 Floor, North Wing, Saltlake, Sector V, Kolkata - 700091</div>
      <div class="bold" style="margin-top:4px;">Factory Address :</div>
      <div>Unit-1 : Vivekananda Industrial Estate, Balitikuri, Bakultala, Howrah - 711113</div>
      <div>Unit-2: Vidyasagar Industrial Park, Plot No. F1, Ruisanda, Rupnarayanpur, Jafala, Gole Bazar, Kharagpur, Paschim Medinipur - 721301</div>
      <div>Email id : info@gmdalui.co.in</div>
      <div>Phone : (+91) 9147176248</div>
    </div>
    <div class="logo">
      <div class="brand">DALUI</div>
      <div class="tag">MAKING VALVES SINCE 1979</div>
    </div>
  </div>

  <!-- Offer No -->
  <div class="offerno">OFFER NO <span class="val">{{docketNo}}</span></div>

  <!-- Content -->
  <div class="content">
    <p class="to-label">To,</p>
    <p class="company-name">{{partyName}}</p>

    <div class="sub-bar">
      <span>SUB:</span>
      <span style="font-weight:normal; flex:1; margin-left:10px;">{{subject}}</span>
    </div>

    <p style="margin-top:10px;">We are pleased to submit our offer for your kind consideration. This offer has been prepared in accordance with the technical requirements and commercial discussions held, and is subject to the terms and conditions outlined below. The detailed price schedule for the proposed scope of supply is enclosed herewith as Annexure–A for your reference.</p>

    <p>We trust that our proposal meets your requirements and assures you of our commitment to quality, reliability, and timely execution. We look forward to the opportunity of working with your esteemed organization and request you to kindly review the enclosed details.</p>

    <p>Please feel free to contact us for any clarification or additional information required.</p>

    <div class="terms-title">Terms &amp; Conditions :</div>
    <div class="terms-list">
      <div class="row"><div class="label">1. Price :</div><div class="value">{{price}}</div></div>
      <div class="row"><div class="label">2. Payment Terms :</div><div class="value">{{paymentTerms}}</div></div>
      <div class="row"><div class="label">3. Inspection :</div><div class="value">{{inspection}}</div></div>
      <div class="row"><div class="label">4. Warranty :</div><div class="value">{{warranty}}</div></div>
      <div class="row"><div class="label">5. Approval :</div><div class="value">{{approval}}</div></div>
      <div class="row"><div class="label">6. Delivery Destination :</div><div class="value">{{deliveryDestination}}</div></div>
    </div>

    <div class="signoff">
      <p class="thanks">Thanks &amp; Regards,</p>
      <p class="for-company">For G.M. Dalui &amp; Sons Pvt. Ltd.</p>
      <p class="name">Ms. Puja Agarwal</p>
      <p>Contact: 88200 44755 / 96747 55238</p>
    </div>

    <div class="enclosed-row">
      <div class="label">Enclosed :</div>
      <div class="value">Annexure-A (Price Bid)</div>
    </div>
  </div>

  <div class="annexure-title">Annexure–A (Price Bid)</div>

  <table class="price-table">
    <thead>
      <tr>
        <th style="width:6%;">SL NO</th>
        <th style="width:26%;">PARTY ITEM NAME</th>
        <th style="width:34%;">OUR ITEM NAME</th>
        <th style="width:8%;">QTY</th>
        <th style="width:10%;">RATE/UNIT</th>
        <th style="width:8%;">UNIT</th>
        <th style="width:8%;">Delivery Schedule</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td>{{inc @index}}</td>
        <td class="item-name">{{this.itemName}}</td>
        <td class="item-name">{{this.partyItemName}}</td>
        <td>{{this.quantity}}</td>
        <td>{{this.quotationRate}}</td>
        <td>Nos.</td>
        <td>{{this.deliverySchedule}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

</div>
</body>
</html>
`