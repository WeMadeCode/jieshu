import { useState } from 'react';
import Button from 'antd/es/button';
import Modal from 'antd/es/modal';
import Select from 'antd/es/select';
import Popover from 'antd/es/popover';

const people = [
  { value: 'jack', label: 'Jack' },
  { value: 'lucy', label: 'Lucy' },
  { value: 'tom', label: 'Tom' },
];

const PersonSelect = ({ inside = false }: { inside?: boolean }) => (
  <Select
    aria-label={inside ? '弹窗内选择器' : '页面选择器'}
    showSearch
    style={{ width: 220 }}
    placeholder={inside ? 'Select a person（弹窗内）' : 'Select a person'}
    optionFilterProp="label"
    options={people}
  />
);

const Dialog = () => {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <h2>弹窗处理</h2>
      <p>弹窗、选择器和气泡卡片使用 Ant Design 默认挂载容器，验证子应用内的浮层和样式隔离。</p>
      <h3>1、打开 antd 弹窗</h3>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal title="Basic Modal" open={open} onOk={() => setOpen(false)} onCancel={() => setOpen(false)} width={760}>
        <div className="react18-modal-scroll">
          <h4>弹窗内：antd 选择器</h4>
          <PersonSelect inside />
          <h4>弹窗内：antd 气泡卡片</h4>
          <Popover content="Content（弹窗内）" title="Title（弹窗内）" trigger="hover">
            <Button>Hover me（弹窗内）</Button>
          </Popover>
          <div className="react18-scroll-spacer" aria-hidden="true" />
        </div>
      </Modal>
      <h3>2、打开 antd 选择器</h3>
      <PersonSelect />
      <h3>3、打开 antd 气泡卡片</h3>
      <Popover content="Content（页面）" title="Title" trigger="hover">
        <Button>Hover me</Button>
      </Popover>
      <div className="react18-scroll-spacer" aria-hidden="true" />
    </section>
  );
};

export default Dialog;
